import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { AttendanceRepository } from "@/application/attendance/attendance-repository";
import {
  attendanceId,
  validateAttendanceCommand,
  validateRecordAttendance,
  validateSessionReason,
} from "@/application/attendance/manage-attendance";
import {
  AttendanceError,
  assertAttendanceDay,
  assertSessionAdjustable,
  canAdjustSession,
  hasOtherActiveEncounter,
  attendanceSummary,
  civilDay,
  effectiveAttendance,
  replacementInterval,
  validateAbsenceLimit,
} from "@/domain/attendance/rules";
import type {
  AttendanceCommandResult,
  AttendanceGroupDto,
  AttendanceMarkDto,
  AttendanceSessionDto,
  AttendanceSettingsDto,
  CancelSessionInput,
  RecordAttendanceInput,
  ReplaceSessionInput,
  UpdateAttendanceSettingsInput,
} from "@/domain/attendance/types";
import { lockInstructorSchedules } from "./instructor-schedule";
import { academicGroupClosed } from "./academic-closure-guard";
import {
  assertSessionIntervalFree,
  eligibleSessionRegistrations,
  ensureGroupSessions,
  materializeSessionRoster,
  loadGroupEligibility,
  type AttendanceDatabase,
  type AttendanceTransaction,
  type SessionRow,
} from "./attendance-calendar";

async function freshActor(
  tx: AttendanceTransaction,
  actorId: string,
  adminOnly = false,
) {
  attendanceId(actorId, "actorId");
  const [actor] = await tx
    .select({ status: s.users.status })
    .from(s.users)
    .where(eq(s.users.id, actorId))
    .for("share");
  const roles = await tx
    .select({ code: s.userRoles.roleCode })
    .from(s.userRoles)
    .where(eq(s.userRoles.userId, actorId))
    .for("share");
  const admin = roles.some((r) => r.code === "ADMIN");
  if (
    !actor ||
    actor.status !== "ACTIVE" ||
    (!admin && (adminOnly || !roles.some((r) => r.code === "INSTRUCTOR")))
  )
    throw new AttendanceError(
      "FORBIDDEN",
      "La cuenta no tiene autorización vigente.",
    );
  return { admin };
}
const settingsDto = (
  r: typeof s.attendanceSettings.$inferSelect,
): AttendanceSettingsDto => ({
  consecutiveAbsenceLimit: r.consecutiveAbsenceLimit,
  revision: r.revision,
  updatedAt: r.updatedAt.toISOString(),
});
async function settings(tx: AttendanceTransaction) {
  await tx.insert(s.attendanceSettings).values({ id: 1 }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(s.attendanceSettings)
    .where(eq(s.attendanceSettings.id, 1));
  if (!row) throw new Error("Attendance settings unavailable");
  return settingsDto(row);
}
async function audit(
  tx: AttendanceTransaction,
  actorId: string,
  sessionId: string,
  action: string,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  await tx.insert(s.auditEvents).values({
    actorId,
    entityType: "SESSION",
    entityId: sessionId,
    action,
    metadata,
  });
}
/** The schedule gate is always acquired before course/group/session locks. */
async function context(
  tx: AttendanceTransaction,
  actorId: string,
  courseId: string,
  groupId: string,
  now: Date,
  adminOnly = false,
) {
  attendanceId(courseId, "courseId");
  attendanceId(groupId, "groupId");
  await lockInstructorSchedules(tx, courseId);
  const { admin } = await freshActor(tx, actorId, adminOnly);
  const [course] = await tx
    .select()
    .from(s.courses)
    .where(eq(s.courses.id, courseId))
    .for("update");
  const [group] = await tx
    .select()
    .from(s.groups)
    .where(and(eq(s.groups.id, groupId), eq(s.groups.courseId, courseId)))
    .for("update");
  if (!course || !group || (!admin && course.instructorId !== actorId))
    throw new AttendanceError("NOT_FOUND", "El grupo no está disponible.");
  if (!admin && now < course.startsAt)
    throw new AttendanceError(
      "FORBIDDEN",
      "El roster se habilita desde el inicio oficial del curso.",
    );
  const closed = await academicGroupClosed(tx, groupId);
  const versions = closed
    ? await tx
        .select()
        .from(s.academicClosureVersions)
        .where(eq(s.academicClosureVersions.groupId, groupId))
        .orderBy(desc(s.academicClosureVersions.version))
        .limit(1)
    : [];
  const report = versions[0]?.report;
  if (closed && !report) throw new Error("Closure version unavailable");
  if (!closed) await ensureGroupSessions(tx, group, now, actorId);
  return { course, group, admin, closed, report };
}
async function sessionRow(
  tx: AttendanceTransaction,
  groupId: string,
  id: string,
) {
  attendanceId(id, "sessionId");
  const [session] = await tx
    .select()
    .from(s.groupSessions)
    .where(
      and(eq(s.groupSessions.id, id), eq(s.groupSessions.groupId, groupId)),
    )
    .for("update");
  if (!session)
    throw new AttendanceError("NOT_FOUND", "La sesión no está disponible.");
  return session;
}
function assertRevision(session: SessionRow, revision: number) {
  if (session.revision !== revision)
    throw new AttendanceError(
      "CONCURRENT_UPDATE",
      "La sesión cambió. Recarga y revisa antes de guardar.",
      { revision: "Recarga la sesión antes de volver a guardar." },
    );
}
type MarkRow = {
  status: "PRESENT" | "ABSENT" | "EXCUSED";
  markedBy: string;
  markedAt: Date;
  actorName: string | null;
};
function markDto(
  row: MarkRow | undefined,
  session: SessionRow,
  now: Date,
): AttendanceMarkDto {
  const status =
    session.cancelledAt && !row
      ? "PENDING"
      : effectiveAttendance(
          row?.status ?? null,
          session.startsAt,
          session.administrativeReviewRequired,
          now,
        );
  return {
    status,
    inferred: !row && status === "ABSENT",
    markedBy: row?.markedBy ?? null,
    markedByName: row?.actorName ?? null,
    markedAt: row?.markedAt.toISOString() ?? null,
  };
}
function sessionDto(
  session: SessionRow,
  now: Date,
  admin: boolean,
  instructorMark?: MarkRow,
): AttendanceSessionDto {
  return {
    id: session.id,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    civilDate: civilDay(session.startsAt),
    status: session.cancelledAt
      ? "CANCELLED"
      : now < session.startsAt
        ? "UPCOMING"
        : now < session.endsAt
          ? "ONGOING"
          : "COMPLETED",
    revision: session.revision,
    administrativeReviewRequired: session.administrativeReviewRequired,
    replacementForSessionId: session.replacementForSessionId,
    cancellationReason: session.cancellationReason,
    canRecord:
      !session.cancelledAt &&
      civilDay(session.startsAt) <= civilDay(now) &&
      (admin ||
        (civilDay(session.startsAt) === civilDay(now) &&
          !session.administrativeReviewRequired)),
    instructorAttendance: markDto(instructorMark, session, now),
  };
}
async function groupDto(
  tx: AttendanceTransaction,
  ctx: Awaited<ReturnType<typeof context>>,
  now: Date,
): Promise<AttendanceGroupDto> {
  const rows = await tx
    .select()
    .from(s.groupSessions)
    .where(eq(s.groupSessions.groupId, ctx.group.id))
    .orderBy(asc(s.groupSessions.startsAt), asc(s.groupSessions.id));
  const instructorMarks = await tx
    .select({
      sessionId: s.instructorAttendance.sessionId,
      status: s.instructorAttendance.status,
      markedBy: s.instructorAttendance.markedBy,
      markedAt: s.instructorAttendance.markedAt,
      actorName: s.users.name,
    })
    .from(s.instructorAttendance)
    .innerJoin(
      s.groupSessions,
      eq(s.groupSessions.id, s.instructorAttendance.sessionId),
    )
    .leftJoin(s.users, eq(s.users.id, s.instructorAttendance.markedBy))
    .where(eq(s.groupSessions.groupId, ctx.group.id));
  const participantMarks = await tx
    .selectDistinct({ sessionId: s.participantAttendance.sessionId })
    .from(s.participantAttendance)
    .innerJoin(
      s.groupSessions,
      eq(s.groupSessions.id, s.participantAttendance.sessionId),
    )
    .where(eq(s.groupSessions.groupId, ctx.group.id));
  const [instructor] = ctx.course.instructorId
    ? await tx
        .select({
          firstName: s.instructorProfiles.firstName,
          lastName: s.instructorProfiles.lastName,
        })
        .from(s.instructorProfiles)
        .where(eq(s.instructorProfiles.id, ctx.course.instructorId))
    : [];
  const active = rows.filter((r) => !r.cancelledAt);
  return {
    courseId: ctx.course.id,
    courseName: ctx.report?.courseName ?? ctx.course.name,
    groupId: ctx.group.id,
    instructorName: ctx.report
      ? ctx.report.instructorName
      : instructor
        ? `${instructor.firstName} ${instructor.lastName}`
        : null,
    officialEndsAt: ctx.course.endsAt.toISOString(),
    operationalEndsAt: active.length
      ? new Date(
          Math.max(...active.map((r) => r.endsAt.getTime())),
        ).toISOString()
      : null,
    settings: ctx.report?.attendanceSettings ?? (await settings(tx)),
    sessions: rows.map((row) => {
      const adjustable = canAdjustSession(
        row.startsAt,
        now,
        instructorMarks.some((m) => m.sessionId === row.id) ||
          participantMarks.some((m) => m.sessionId === row.id),
      );
      const dto = sessionDto(
        row,
        now,
        ctx.admin,
        instructorMarks.find((m) => m.sessionId === row.id),
      );
      return {
        ...dto,
        canCancel: !ctx.closed && ctx.admin && !row.cancelledAt && adjustable,
        canReplace:
          !ctx.closed &&
          ctx.admin &&
          ctx.group.status === "PLANNED" &&
          adjustable &&
          !hasOtherActiveEncounter(row, rows),
        canRecord:
          !ctx.closed &&
          dto.canRecord &&
          (ctx.admin || ctx.group.status === "PLANNED"),
        instructorAttendance:
          ctx.report?.sessions.find((s) => s.id === row.id)
            ?.instructorAttendance ??
          (ctx.course.instructorId
            ? dto.instructorAttendance
            : {
                status: "PENDING" as const,
                inferred: false,
                markedBy: null,
                markedByName: null,
                markedAt: null,
              }),
      };
    }),
  };
}

export class DrizzleAttendanceRepository implements AttendanceRepository {
  constructor(
    private readonly db: AttendanceDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  private async assertAdjustable(
    tx: AttendanceTransaction,
    session: SessionRow,
  ) {
    const [participant] = await tx
      .select({ sessionId: s.participantAttendance.sessionId })
      .from(s.participantAttendance)
      .where(eq(s.participantAttendance.sessionId, session.id))
      .limit(1);
    const [instructor] = await tx
      .select({ sessionId: s.instructorAttendance.sessionId })
      .from(s.instructorAttendance)
      .where(eq(s.instructorAttendance.sessionId, session.id))
      .limit(1);
    // Sample after acquiring the schedule/session locks, not before a potentially long wait.
    const now = this.clock();
    assertSessionAdjustable(
      session.startsAt,
      now,
      Boolean(participant || instructor),
    );
    return now;
  }
  async getGroup(actorId: string, courseId: string, groupId: string) {
    return this.db.transaction(async (tx) => {
      const now = this.clock();
      const ctx = await context(tx, actorId, courseId, groupId, now);
      return groupDto(tx, ctx, now);
    });
  }
  async getSession(
    actorId: string,
    courseId: string,
    groupId: string,
    sessionId: string,
  ) {
    return this.db.transaction(async (tx) => {
      const now = this.clock();
      const ctx = await context(tx, actorId, courseId, groupId, now);
      const selected = await sessionRow(tx, groupId, sessionId);
      const rows = await tx
        .select()
        .from(s.groupSessions)
        .where(eq(s.groupSessions.groupId, groupId))
        .orderBy(asc(s.groupSessions.startsAt), asc(s.groupSessions.id));
      const eligibility = ctx.closed
        ? []
        : await loadGroupEligibility(tx, groupId, ctx.course.startsAt, now);
      for (const row of ctx.closed ? [] : rows)
        await materializeSessionRoster(
          tx,
          groupId,
          ctx.course.startsAt,
          row,
          now,
          eligibility,
        );
      const group = await groupDto(tx, ctx, now);
      const session = group.sessions.find((r) => r.id === sessionId)!;
      const roster = await tx
        .select({
          registration: {
            id: s.preRegistrations.id,
            state: s.preRegistrations.state,
          },
          firstName: s.participants.firstName,
          lastName: s.participants.lastName,
        })
        .from(s.sessionRoster)
        .innerJoin(
          s.preRegistrations,
          eq(s.preRegistrations.id, s.sessionRoster.registrationId),
        )
        .innerJoin(
          s.participants,
          eq(s.participants.id, s.preRegistrations.participantId),
        )
        .where(eq(s.sessionRoster.sessionId, sessionId))
        .orderBy(
          asc(s.participants.lastName),
          asc(s.participants.firstName),
          asc(s.preRegistrations.id),
        );
      const marks = await tx
        .select({
          sessionId: s.participantAttendance.sessionId,
          registrationId: s.participantAttendance.registrationId,
          status: s.participantAttendance.status,
          markedBy: s.participantAttendance.markedBy,
          markedAt: s.participantAttendance.markedAt,
          actorName: s.users.name,
        })
        .from(s.participantAttendance)
        .innerJoin(
          s.groupSessions,
          eq(s.groupSessions.id, s.participantAttendance.sessionId),
        )
        .leftJoin(s.users, eq(s.users.id, s.participantAttendance.markedBy))
        .where(eq(s.groupSessions.groupId, groupId));
      const membership = await tx
        .select({
          sessionId: s.sessionRoster.sessionId,
          registrationId: s.sessionRoster.registrationId,
        })
        .from(s.sessionRoster)
        .innerJoin(
          s.groupSessions,
          eq(s.groupSessions.id, s.sessionRoster.sessionId),
        )
        .where(eq(s.groupSessions.groupId, groupId));
      const eligibleNow = ctx.closed
        ? []
        : await eligibleSessionRegistrations(
            tx,
            groupId,
            ctx.course.startsAt,
            selected,
            now,
            eligibility,
          );
      return {
        group,
        session,
        reviewCandidates:
          !ctx.closed && ctx.admin && selected.administrativeReviewRequired
            ? eligibleNow.map((e) => ({
                registrationId: e.registration.id,
                firstName: e.firstName,
                lastName: e.lastName,
              }))
            : [],
        participants: (ctx.report
          ? (
              ctx.report.sessions.find((s) => s.id === sessionId)
                ?.participants ?? []
            ).map((p) => ({
              registration: { id: p.registrationId, state: "ACTIVE" as const },
              firstName: p.firstName,
              lastName: p.lastName,
            }))
          : roster
        ).map(({ registration: r, firstName, lastName }) => ({
          registrationId: r.id,
          firstName,
          lastName,
          currentlyEnrolled: ctx.report
            ? ctx.report.participants.some((p) => p.registrationId === r.id)
            : r.state === "ACTIVE" &&
              eligibleNow.some((e) => e.registration.id === r.id),
          ...attendanceSummary(
            ctx.report
              ? ctx.report.sessions
                  .filter((s) => !s.cancelledAt)
                  .flatMap((s) =>
                    s.participants
                      .filter((p) => p.registrationId === r.id)
                      .map((p) => p.attendance.status),
                  )
              : rows
                  .filter(
                    (row) =>
                      !row.cancelledAt &&
                      membership.some(
                        (m) =>
                          m.sessionId === row.id && m.registrationId === r.id,
                      ),
                  )
                  .map((row) =>
                    effectiveAttendance(
                      marks.find(
                        (m) =>
                          m.sessionId === row.id && m.registrationId === r.id,
                      )?.status ?? null,
                      row.startsAt,
                      row.administrativeReviewRequired,
                      now,
                    ),
                  ),
            group.settings.consecutiveAbsenceLimit,
          ),
          attendance:
            ctx.report?.sessions
              .find((s) => s.id === selected.id)
              ?.participants.find((p) => p.registrationId === r.id)
              ?.attendance ??
            markDto(
              marks.find(
                (m) => m.sessionId === selected.id && m.registrationId === r.id,
              ),
              selected,
              now,
            ),
        })),
      };
    });
  }
  private async command(
    tx: AttendanceTransaction,
    actorId: string,
    key: string,
    operation: string,
    input: unknown,
    work: () => Promise<AttendanceCommandResult>,
  ): Promise<AttendanceCommandResult> {
    attendanceId(key, "requestKey");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ operation, input }))
      .digest("hex");
    // Schedule gate already serializes commands; settings uses the same gate.
    const [receipt] = await tx
      .select()
      .from(s.attendanceCommandReceipts)
      .where(
        and(
          eq(s.attendanceCommandReceipts.actorId, actorId),
          eq(s.attendanceCommandReceipts.requestKey, key),
        ),
      );
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        throw new AttendanceError(
          "IDEMPOTENCY_CONFLICT",
          "La clave ya se usó con otros datos.",
        );
      return receipt.result;
    }
    const result = await work();
    await tx
      .insert(s.attendanceCommandReceipts)
      .values({ actorId, requestKey: key, fingerprint, result });
    return result;
  }
  async record(actorId: string, input: RecordAttendanceInput) {
    validateRecordAttendance(input);
    return this.db.transaction(async (tx) => {
      const now = this.clock();
      const ctx = await context(
        tx,
        actorId,
        input.courseId,
        input.groupId,
        now,
      );
      if (ctx.closed)
        throw new AttendanceError(
          "GROUP_CLOSED",
          "Reabre el grupo antes de corregir asistencia.",
        );
      return this.command(
        tx,
        actorId,
        input.requestKey,
        "RECORD",
        input,
        async () => {
          const session = await sessionRow(tx, input.groupId, input.sessionId);
          assertRevision(session, input.revision);
          if (
            session.cancelledAt ||
            (ctx.group.status === "CANCELLED" && !ctx.admin)
          )
            throw new AttendanceError(
              "SESSION_CANCELLED",
              "No se registra asistencia en sesiones canceladas.",
            );
          assertAttendanceDay(session.startsAt, now, ctx.admin);
          if (
            !ctx.admin &&
            (input.instructorStatus !== undefined ||
              input.reviewRegistrationIds !== undefined ||
              input.completeAdministrativeReview !== undefined)
          )
            throw new AttendanceError(
              "FORBIDDEN",
              "La asistencia del instructor y la revisión histórica son administrativas.",
            );
          if (session.administrativeReviewRequired && !ctx.admin)
            throw new AttendanceError(
              "REVIEW_REQUIRED",
              "La sesión histórica requiere revisión administrativa.",
            );
          if (
            input.reviewRegistrationIds !== undefined ||
            input.completeAdministrativeReview
          ) {
            if (!session.administrativeReviewRequired)
              throw new AttendanceError(
                "VALIDATION_FAILED",
                "La sesión no requiere revisión histórica.",
              );
            const eligible = await eligibleSessionRegistrations(
              tx,
              input.groupId,
              ctx.course.startsAt,
              session,
              now,
            );
            const requested = input.reviewRegistrationIds ?? [];
            if (
              requested.some(
                (id) => !eligible.some((e) => e.registration.id === id),
              )
            )
              throw new AttendanceError(
                "NOT_ENROLLED",
                "La revisión solo admite personas inscritas en ese día y grupo.",
              );
            if (requested.length)
              await tx
                .insert(s.sessionRoster)
                .values(
                  requested.map((id) => ({
                    sessionId: session.id,
                    registrationId: id,
                    reviewedBy: actorId,
                    establishedAt: now,
                  })),
                )
                .onConflictDoNothing();
            await audit(
              tx,
              actorId,
              session.id,
              "ATTENDANCE_HISTORY_REVIEWED",
              {
                completed: input.completeAdministrativeReview === true,
                participantCount: requested.length,
              },
            );
          }
          await materializeSessionRoster(
            tx,
            input.groupId,
            ctx.course.startsAt,
            session,
            now,
          );
          const roster = await tx
            .select({
              id: s.sessionRoster.registrationId,
              state: s.preRegistrations.state,
            })
            .from(s.sessionRoster)
            .innerJoin(
              s.preRegistrations,
              eq(s.preRegistrations.id, s.sessionRoster.registrationId),
            )
            .where(eq(s.sessionRoster.sessionId, session.id));
          if (
            input.marks.some(
              (m) =>
                !roster.some(
                  (r) =>
                    r.id === m.registrationId &&
                    (ctx.admin || r.state === "ACTIVE"),
                ),
            )
          )
            throw new AttendanceError(
              "NOT_ENROLLED",
              "Solo se registra el roster inscrito de esta sesión.",
            );
          for (const mark of input.marks) {
            const [previous] = await tx
              .select({ status: s.participantAttendance.status })
              .from(s.participantAttendance)
              .where(
                and(
                  eq(s.participantAttendance.sessionId, session.id),
                  eq(
                    s.participantAttendance.registrationId,
                    mark.registrationId,
                  ),
                ),
              );
            await tx
              .insert(s.participantAttendance)
              .values({
                sessionId: session.id,
                ...mark,
                markedBy: actorId,
                markedAt: now,
              })
              .onConflictDoUpdate({
                target: [
                  s.participantAttendance.sessionId,
                  s.participantAttendance.registrationId,
                ],
                set: { status: mark.status, markedBy: actorId, markedAt: now },
              });
            await audit(
              tx,
              actorId,
              session.id,
              "PARTICIPANT_ATTENDANCE_RECORDED",
              {
                registrationId: mark.registrationId,
                from: previous?.status ?? null,
                to: mark.status,
                administrativeCorrection:
                  ctx.admin && civilDay(now) > civilDay(session.startsAt),
              },
            );
          }
          if (input.instructorStatus !== undefined) {
            if (!ctx.course.instructorId)
              throw new AttendanceError(
                "VALIDATION_FAILED",
                "Asigna un instructor antes de registrar su asistencia.",
              );
            const [previous] = await tx
              .select({ status: s.instructorAttendance.status })
              .from(s.instructorAttendance)
              .where(eq(s.instructorAttendance.sessionId, session.id));
            await tx
              .insert(s.instructorAttendance)
              .values({
                sessionId: session.id,
                instructorId: ctx.course.instructorId,
                status: input.instructorStatus,
                markedBy: actorId,
                markedAt: now,
              })
              .onConflictDoUpdate({
                target: s.instructorAttendance.sessionId,
                set: {
                  status: input.instructorStatus,
                  markedBy: actorId,
                  markedAt: now,
                },
              });
            await audit(
              tx,
              actorId,
              session.id,
              "INSTRUCTOR_ATTENDANCE_RECORDED",
              { from: previous?.status ?? null, to: input.instructorStatus },
            );
          }
          await tx
            .update(s.groupSessions)
            .set({
              revision: session.revision + 1,
              ...(input.completeAdministrativeReview
                ? { administrativeReviewRequired: false, rosterReviewedAt: now }
                : {}),
            })
            .where(eq(s.groupSessions.id, session.id));
          return {
            kind: "session",
            sessionId: session.id,
            revision: session.revision + 1,
          };
        },
      );
    });
  }
  async cancel(actorId: string, input: CancelSessionInput) {
    validateAttendanceCommand(input);
    validateSessionReason(input.reason);
    return this.db.transaction(async (tx) => {
      const now = this.clock();
      const ctx = await context(
        tx,
        actorId,
        input.courseId,
        input.groupId,
        now,
        true,
      );
      if (ctx.closed)
        throw new AttendanceError(
          "GROUP_CLOSED",
          "Reabre el grupo antes de modificar sesiones.",
        );
      return this.command(
        tx,
        actorId,
        input.requestKey,
        "CANCEL",
        input,
        async () => {
          const session = await sessionRow(tx, input.groupId, input.sessionId);
          assertRevision(session, input.revision);
          if (session.cancelledAt)
            throw new AttendanceError(
              "SESSION_CANCELLED",
              "La sesión ya está cancelada.",
            );
          const mutationNow = await this.assertAdjustable(tx, session);
          await tx
            .update(s.groupSessions)
            .set({
              cancelledAt: mutationNow,
              cancelledBy: actorId,
              cancellationReason: input.reason?.trim() ?? "",
              revision: session.revision + 1,
            })
            .where(eq(s.groupSessions.id, session.id));
          await audit(tx, actorId, session.id, "SESSION_CANCELLED", {
            reason: input.reason?.trim() ?? "",
          });
          return {
            kind: "session",
            sessionId: session.id,
            revision: session.revision + 1,
          };
        },
      );
    });
  }
  async replace(actorId: string, input: ReplaceSessionInput) {
    validateAttendanceCommand(input);
    validateSessionReason(input.reason);
    return this.db.transaction(async (tx) => {
      const now = this.clock();
      const ctx = await context(
        tx,
        actorId,
        input.courseId,
        input.groupId,
        now,
        true,
      );
      if (ctx.closed)
        throw new AttendanceError(
          "GROUP_CLOSED",
          "Reabre el grupo antes de modificar sesiones.",
        );
      return this.command(
        tx,
        actorId,
        input.requestKey,
        "REPLACE",
        input,
        async () => {
          const original = await sessionRow(tx, input.groupId, input.sessionId);
          assertRevision(original, input.revision);
          if (ctx.group.status !== "PLANNED")
            throw new AttendanceError(
              "SESSION_CANCELLED",
              "El grupo está cancelado.",
            );
          const family = await tx
            .select()
            .from(s.groupSessions)
            .where(eq(s.groupSessions.groupId, input.groupId));
          if (hasOtherActiveEncounter(original, family))
            throw new AttendanceError(
              "CONCURRENT_UPDATE",
              "El encuentro original ya tiene una recuperación activa en su cadena.",
            );
          const interval = replacementInterval(
            input.startsAt,
            (original.endsAt.getTime() - original.startsAt.getTime()) / 60000,
          );
          await assertSessionIntervalFree(
            tx,
            input.courseId,
            input.groupId,
            ctx.course.instructorId,
            interval,
            original.id,
          );
          const mutationNow = await this.assertAdjustable(tx, original);
          if (interval.startsAt <= mutationNow)
            throw new AttendanceError(
              "VALIDATION_FAILED",
              "El reemplazo debe comenzar en el futuro.",
              { startsAt: "Selecciona una hora futura." },
            );
          if (!original.cancelledAt) {
            await tx
              .update(s.groupSessions)
              .set({
                cancelledAt: mutationNow,
                cancelledBy: actorId,
                cancellationReason: input.reason?.trim() ?? "Reprogramación",
                revision: original.revision + 1,
              })
              .where(eq(s.groupSessions.id, original.id));
            await audit(tx, actorId, original.id, "SESSION_CANCELLED", {
              reason: input.reason?.trim() ?? "Reprogramación",
            });
          }
          const [replacement] = await tx
            .insert(s.groupSessions)
            .values({
              ...interval,
              groupId: input.groupId,
              courseTypeRevisionId: original.courseTypeRevisionId,
              replacementForSessionId: original.id,
              administrativeReviewRequired: false,
            })
            .returning();
          if (!replacement) throw new Error("Session insert failed");
          await audit(
            tx,
            actorId,
            replacement.id,
            "SESSION_REPLACEMENT_CREATED",
            {
              replacementForSessionId: original.id,
              startsAt: interval.startsAt.toISOString(),
              endsAt: interval.endsAt.toISOString(),
            },
          );
          return {
            kind: "session",
            sessionId: replacement.id,
            revision: replacement.revision,
          };
        },
      );
    });
  }
  async getSettings(actorId: string) {
    return this.db.transaction(async (tx) => {
      await freshActor(tx, actorId, true);
      return settings(tx);
    });
  }
  async updateSettings(actorId: string, input: UpdateAttendanceSettingsInput) {
    attendanceId(input.requestKey, "requestKey");
    validateAbsenceLimit(input.consecutiveAbsenceLimit);
    if (!Number.isInteger(input.revision) || input.revision < 1)
      throw new AttendanceError("VALIDATION_FAILED", "Revisión no válida.");
    return this.db.transaction(async (tx) => {
      await lockInstructorSchedules(tx);
      await freshActor(tx, actorId, true);
      return this.command(
        tx,
        actorId,
        input.requestKey,
        "SETTINGS",
        input,
        async () => {
          const current = await settings(tx);
          if (current.revision !== input.revision)
            throw new AttendanceError(
              "CONCURRENT_UPDATE",
              "La configuración cambió. Recarga antes de guardar.",
            );
          const [row] = await tx
            .update(s.attendanceSettings)
            .set({
              consecutiveAbsenceLimit: input.consecutiveAbsenceLimit,
              revision: current.revision + 1,
              updatedBy: actorId,
              updatedAt: this.clock(),
            })
            .where(eq(s.attendanceSettings.id, 1))
            .returning();
          if (!row) throw new Error("Settings update failed");
          await tx.insert(s.auditEvents).values({
            actorId,
            entityType: "ATTENDANCE_SETTINGS",
            entityId: actorId,
            action: "ATTENDANCE_SETTINGS_UPDATED",
            metadata: {
              from: current.consecutiveAbsenceLimit,
              to: input.consecutiveAbsenceLimit,
            },
          });
          return { kind: "settings", settings: settingsDto(row) };
        },
      );
    });
  }
}
