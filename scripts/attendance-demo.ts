import { asc, eq, inArray, or } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { InternalUser } from "@/domain/auth/types";
import { DrizzleAttendanceRepository } from "@/server/db/repositories/attendance-repository";
import { DrizzleRegistrationRepository } from "@/server/db/repositories/registration-repository";
import {
  assertActiveInstructor,
  instructorHasConflict,
  lockInstructorSchedules,
} from "@/server/db/repositories/instructor-schedule";
import {
  requireFreshRegistrationActor,
  type RegistrationTransaction,
} from "@/server/db/repositories/registration-support";
import {
  createRegistration,
  getRegistrationForm,
} from "@/application/pre-registrations/manage-registrations";
import {
  getAttendanceGroup,
  getAttendanceSession,
  recordAttendance,
  cancelAttendanceSession,
  replaceAttendanceSession,
  requireAttendanceActor,
} from "@/application/attendance/manage-attendance";
import {
  financialDemoId,
  FINANCIAL_DEMO_OWNER,
  fingerprint,
  type FinancialDemoContext,
} from "./financial-demo-plan";
import {
  attendanceDemoId,
  attendanceDemoPlan,
  ATTENDANCE_DEMO_OWNER,
  demoAttendanceStatus,
  type AttendanceDemoPlan,
  type AttendanceDemoContext,
} from "./attendance-demo-plan";

const manifestId = attendanceDemoId("manifest");
type Preview = (plan: AttendanceDemoPlan, existing: boolean) => void;
const commandKeys = (plan: AttendanceDemoPlan) => [
  ...plan.recordRequestKeys,
  ...plan.sessionRequestKeys,
];

async function assertNoAttendanceCollisions(
  tx: RegistrationTransaction,
  plan: AttendanceDemoPlan,
): Promise<void> {
  const hits = await Promise.all([
    tx
      .select({ id: s.courseTypes.id })
      .from(s.courseTypes)
      .where(
        or(
          eq(s.courseTypes.id, plan.format.id),
          eq(s.courseTypes.name, plan.format.name),
        ),
      ),
    tx
      .select({ id: s.courseTypeRevisions.id })
      .from(s.courseTypeRevisions)
      .where(eq(s.courseTypeRevisions.id, plan.course.courseTypeRevisionId)),
    tx
      .select({ id: s.courses.id })
      .from(s.courses)
      .where(
        or(
          eq(s.courses.id, plan.course.id),
          eq(s.courses.slug, plan.course.slug),
        ),
      ),
    tx
      .select({ id: s.groups.id })
      .from(s.groups)
      .where(
        inArray(
          s.groups.id,
          plan.groups.map((g) => g.id),
        ),
      ),
    tx
      .select({ id: s.participants.id })
      .from(s.participants)
      .where(
        inArray(
          s.participants.ci,
          plan.participants.map((p) => p.participant.ci),
        ),
      ),
    tx
      .select({ id: s.registrationCommandReceipts.id })
      .from(s.registrationCommandReceipts)
      .where(
        inArray(
          s.registrationCommandReceipts.requestKey,
          plan.participants.map((p) => p.requestKey),
        ),
      ),
    tx
      .select({ id: s.attendanceCommandReceipts.id })
      .from(s.attendanceCommandReceipts)
      .where(
        inArray(s.attendanceCommandReceipts.requestKey, commandKeys(plan)),
      ),
    tx
      .select({ id: s.auditEvents.id })
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, attendanceDemoId("course-marker"))),
  ]);
  if (hits.some((rows) => rows.length))
    throw new Error(
      "Attendance fixture collision without owned manifest; nothing adopted or repaired",
    );
}
async function attendanceStateHash(
  tx: RegistrationTransaction,
  plan: AttendanceDemoPlan,
): Promise<string> {
  const groupIds = plan.groups.map((g) => g.id);
  const sessions = await tx
    .select()
    .from(s.groupSessions)
    .where(inArray(s.groupSessions.groupId, groupIds))
    .orderBy(asc(s.groupSessions.id));
  const ids = sessions.map((row) => row.id);
  const registrations = await tx
    .select()
    .from(s.preRegistrations)
    .where(eq(s.preRegistrations.courseId, plan.course.id))
    .orderBy(asc(s.preRegistrations.id));
  const registrationIds = registrations.map((r) => r.id);
  const participantIds = registrations.map((r) => r.participantId);
  return fingerprint({
    format: await tx
      .select()
      .from(s.courseTypes)
      .where(eq(s.courseTypes.id, plan.format.id)),
    revision: await tx
      .select()
      .from(s.courseTypeRevisions)
      .where(eq(s.courseTypeRevisions.id, plan.course.courseTypeRevisionId)),
    course: await tx
      .select()
      .from(s.courses)
      .where(eq(s.courses.id, plan.course.id)),
    groups: await tx
      .select()
      .from(s.groups)
      .where(inArray(s.groups.id, groupIds))
      .orderBy(asc(s.groups.id)),
    assignments: await tx
      .select()
      .from(s.courseInstructorHistory)
      .where(eq(s.courseInstructorHistory.courseId, plan.course.id))
      .orderBy(asc(s.courseInstructorHistory.instructorId)),
    provenance: await tx
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, attendanceDemoId("course-marker"))),
    registrations,
    participants: participantIds.length
      ? await tx
          .select()
          .from(s.participants)
          .where(inArray(s.participants.id, participantIds))
          .orderBy(asc(s.participants.id))
      : [],
    ledger: registrationIds.length
      ? await tx
          .select()
          .from(s.registrationLedger)
          .where(inArray(s.registrationLedger.registrationId, registrationIds))
          .orderBy(asc(s.registrationLedger.id))
      : [],
    financialReceipts: await tx
      .select()
      .from(s.registrationCommandReceipts)
      .where(
        inArray(
          s.registrationCommandReceipts.requestKey,
          plan.participants.map((p) => p.requestKey),
        ),
      )
      .orderBy(asc(s.registrationCommandReceipts.id)),
    sessions,
    roster: ids.length
      ? await tx
          .select()
          .from(s.sessionRoster)
          .where(inArray(s.sessionRoster.sessionId, ids))
          .orderBy(
            asc(s.sessionRoster.sessionId),
            asc(s.sessionRoster.registrationId),
          )
      : [],
    marks: ids.length
      ? await tx
          .select()
          .from(s.participantAttendance)
          .where(inArray(s.participantAttendance.sessionId, ids))
          .orderBy(
            asc(s.participantAttendance.sessionId),
            asc(s.participantAttendance.registrationId),
          )
      : [],
    instructorMarks: ids.length
      ? await tx
          .select()
          .from(s.instructorAttendance)
          .where(inArray(s.instructorAttendance.sessionId, ids))
          .orderBy(asc(s.instructorAttendance.sessionId))
      : [],
    receipts: await tx
      .select()
      .from(s.attendanceCommandReceipts)
      .where(inArray(s.attendanceCommandReceipts.requestKey, commandKeys(plan)))
      .orderBy(asc(s.attendanceCommandReceipts.id)),
  });
}
async function applyAttendanceFixtures(
  tx: RegistrationTransaction,
  actor: InternalUser,
  financial: FinancialDemoContext,
  plan: AttendanceDemoPlan,
  instructorId: string,
): Promise<AttendanceDemoContext> {
  await tx
    .insert(s.courseTypes)
    .values({ id: plan.format.id, name: plan.format.name });
  await tx.insert(s.courseTypeRevisions).values({
    ...plan.format,
    id: plan.course.courseTypeRevisionId,
    courseTypeId: plan.format.id,
    revisionNumber: 1,
  });
  await tx.insert(s.courses).values({ ...plan.course, instructorId });
  await tx.insert(s.groups).values(plan.groups);
  await tx
    .insert(s.courseInstructorHistory)
    .values({ courseId: plan.course.id, instructorId, actorId: actor.id });
  await tx.insert(s.auditEvents).values({
    id: attendanceDemoId("course-marker"),
    actorId: actor.id,
    entityType: "COURSE",
    entityId: plan.course.id,
    action: "DEMO_SEEDED",
    metadata: {
      seedOwner: ATTENDANCE_DEMO_OWNER,
      anchorDay: plan.anchorDay,
      parentOwner: financial.owner,
    },
  });
  const context = {
    owner: ATTENDANCE_DEMO_OWNER,
    anchorDay: plan.anchorDay,
    consecutiveAbsenceLimit: plan.limit,
    financialContextHash: fingerprint(financial),
    courseId: plan.course.id,
    groupIds: plan.groups.map((g) => g.id),
    registrations: {} as Record<string, string>,
    sessions: {} as Record<string, string>,
  };
  // A separate free cohort permits simultaneous N and N+1 examples without
  // changing the parent seed's immutable financial snapshots/history.
  const money = new DrizzleRegistrationRepository(
    tx,
    () => plan.enrollmentClock,
  );
  const form = await getRegistrationForm(money, actor, plan.course.id);
  if (!form) throw new Error("Attendance demo registration context missing");
  for (const fixture of plan.participants) {
    const row = await createRegistration(
      money,
      actor,
      {
        requestKey: fixture.requestKey,
        courseId: plan.course.id,
        groupId: plan.groups[0]!.id,
        participant: fixture.participant,
        participantType: "STUDENT",
        sourceInterestId: null,
        settingsRevision: form.settings.revision,
        courseRevision: form.course.revision,
        firstDayException: false,
        initialPayment: null,
      },
      plan.enrollmentClock,
    );
    context.registrations[fixture.key] = row.id;
  }
  const repository = new DrizzleAttendanceRepository(tx, () => plan.clock);
  // Lazy materialization is the existing authorized backend bootstrap. It
  // assigns random IDs once and marks historical sessions for explicit review.
  const group = await getAttendanceGroup(
    repository,
    actor,
    plan.course.id,
    plan.groups[0]!.id,
  );
  await getAttendanceGroup(
    repository,
    actor,
    plan.course.id,
    plan.groups[1]!.id,
  );
  group.sessions.forEach((session, i) => {
    context.sessions[`original:${i + 1}`] = session.id;
  });
  const historical = group.sessions.filter(
    (row) => row.civilDate < plan.anchorDay,
  );
  if (historical.length < plan.reviewedCount + 1)
    throw new Error(
      "Insufficient historical sessions for reviewed and pending examples",
    );
  for (let i = 0; i < plan.reviewedCount; i++) {
    const session = historical[i]!;
    await recordAttendance(repository, actor, {
      requestKey: plan.recordRequestKeys[i]!,
      courseId: plan.course.id,
      groupId: plan.groups[0]!.id,
      sessionId: session.id,
      revision: session.revision,
      reviewRegistrationIds: Object.values(context.registrations),
      completeAdministrativeReview: true,
      marks: plan.participants.map((p) => ({
        registrationId: context.registrations[p.key]!,
        status: demoAttendanceStatus(p.key, i),
      })),
      instructorStatus: i === 0 ? "EXCUSED" : i <= 2 ? "ABSENT" : "PRESENT",
    });
  }
  context.sessions.reviewPending = historical[plan.reviewedCount]!.id;
  context.sessions.recorded = historical[plan.reviewedCount - 1]!.id;
  const future = group.sessions.filter((row) => row.civilDate > plan.anchorDay);
  if (future.length < 3)
    throw new Error(
      "Insufficient future sessions for replacements/cancellation",
    );
  for (const [i, key, startsAt] of [
    [0, "today", plan.todayReplacementAt],
    [1, "weekend", plan.weekendReplacementAt],
  ] as const) {
    const original = future[i]!;
    const result = await replaceAttendanceSession(repository, actor, {
      requestKey: attendanceDemoId(`replace:${key}`),
      courseId: plan.course.id,
      groupId: plan.groups[0]!.id,
      sessionId: original.id,
      revision: original.revision,
      startsAt,
      reason: "Recuperación ficticia de demostración",
    });
    if (result.kind !== "session")
      throw new Error("Unexpected replacement receipt");
    context.sessions[`cancelledOriginal:${key}`] = original.id;
    context.sessions[`replacement:${key}`] = result.sessionId;
  }
  const cancelled = future[2]!;
  await cancelAttendanceSession(repository, actor, {
    requestKey: attendanceDemoId("cancel"),
    courseId: plan.course.id,
    groupId: plan.groups[0]!.id,
    sessionId: cancelled.id,
    revision: cancelled.revision,
    reason: "Sesión cancelada de demostración",
  });
  context.sessions.cancelled = cancelled.id;
  context.sessions.todayPending =
    group.sessions.find((row) => row.civilDate === plan.anchorDay)?.id ??
    context.sessions["replacement:today"]!;
  // Establish ordinary eligible roster today without writing attendance marks.
  await getAttendanceSession(
    repository,
    actor,
    plan.course.id,
    plan.groups[0]!.id,
    context.sessions.todayPending,
  );
  await getAttendanceSession(
    repository,
    actor,
    plan.course.id,
    plan.groups[0]!.id,
    context.sessions["replacement:today"]!,
  );
  return context;
}

/** Called only inside the financial runner's verified operator transaction.
 * PLAN uses direct read-only inspections; it must never call mutating getGroup.
 */
export async function runAttendanceDemo(
  tx: RegistrationTransaction,
  actor: InternalUser,
  financial: FinancialDemoContext,
  apply: boolean,
  preview?: Preview,
): Promise<AttendanceDemoContext | null> {
  requireAttendanceActor(actor, true);
  if (apply) {
    await lockInstructorSchedules(tx);
    await requireFreshRegistrationActor(tx, actor.id);
  }
  const [settings] = await tx
    .select()
    .from(s.attendanceSettings)
    .where(eq(s.attendanceSettings.id, 1));
  if (!settings)
    throw new Error(
      "0019 attendance settings required; seed never installs migrations or changes N",
    );
  // Read every 0019 capability, including empty tables, before any fixture work.
  await tx.select({ id: s.groupSessions.id }).from(s.groupSessions).limit(1);
  await tx
    .select({ id: s.sessionRoster.sessionId })
    .from(s.sessionRoster)
    .limit(1);
  await tx
    .select({ id: s.participantAttendance.sessionId })
    .from(s.participantAttendance)
    .limit(1);
  await tx
    .select({ id: s.instructorAttendance.sessionId })
    .from(s.instructorAttendance)
    .limit(1);
  await tx
    .select({ id: s.attendanceCommandReceipts.id })
    .from(s.attendanceCommandReceipts)
    .limit(1);
  const plan = attendanceDemoPlan(financial, settings.consecutiveAbsenceLimit);
  const [marker] = await tx
    .select()
    .from(s.auditEvents)
    .where(eq(s.auditEvents.id, manifestId));
  if (marker) {
    if (
      marker.actorId !== actor.id ||
      marker.action !== "DEMO_SEEDED" ||
      marker.entityType !== "DEMO" ||
      marker.entityId !== manifestId ||
      marker.metadata.seedOwner !== ATTENDANCE_DEMO_OWNER ||
      marker.metadata.parentContextHash !== fingerprint(financial) ||
      marker.metadata.planHash !== fingerprint(plan) ||
      marker.metadata.stateHash !== (await attendanceStateHash(tx, plan))
    )
      throw new Error(
        "Attendance fixture provenance/state/settings changed; no replay or repair allowed",
      );
    const context: AttendanceDemoContext = JSON.parse(
      String(marker.metadata.context),
    );
    if (
      context.owner !== ATTENDANCE_DEMO_OWNER ||
      context.anchorDay !== financial.anchorDay ||
      marker.metadata.contextHash !== fingerprint(context)
    )
      throw new Error("Invalid attendance context");
    preview?.(plan, true);
    return context;
  }
  await assertNoAttendanceCollisions(tx, plan);
  const parent = financial.courses.past;
  if (!parent || parent.courseId !== financialDemoId("course:past"))
    throw new Error("Owned financial course context required");
  const [parentCourse] = await tx
    .select({ instructorId: s.courses.instructorId })
    .from(s.courses)
    .where(eq(s.courses.id, parent.courseId));
  if (parentCourse?.instructorId) {
    await assertActiveInstructor(tx, parentCourse.instructorId, true);
    if (
      await instructorHasConflict(
        tx,
        plan.course.id,
        parentCourse.instructorId,
        plan.groups,
      )
    )
      throw new Error("Attendance demo instructor schedule conflict");
  } else if (apply) throw new Error("Existing parent instructor required");
  preview?.(plan, false);
  if (!apply) return null;
  const [parentMarker] = await tx
    .select()
    .from(s.auditEvents)
    .where(eq(s.auditEvents.id, financialDemoId("manifest")));
  if (
    parentMarker?.actorId !== actor.id ||
    parentMarker.metadata.seedOwner !== FINANCIAL_DEMO_OWNER ||
    parentMarker.metadata.contextHash !== fingerprint(financial)
  )
    throw new Error("Financial provenance required before attendance apply");
  const context = await applyAttendanceFixtures(
    tx,
    actor,
    financial,
    plan,
    parentCourse!.instructorId!,
  );
  await tx.insert(s.auditEvents).values({
    id: manifestId,
    actorId: actor.id,
    entityType: "DEMO",
    entityId: manifestId,
    action: "DEMO_SEEDED",
    metadata: {
      seedOwner: ATTENDANCE_DEMO_OWNER,
      anchorDay: plan.anchorDay,
      parentContextHash: fingerprint(financial),
      planHash: fingerprint(plan),
      stateHash: await attendanceStateHash(tx, plan),
      context: JSON.stringify(context),
      contextHash: fingerprint(context),
    },
  });
  return context;
}
