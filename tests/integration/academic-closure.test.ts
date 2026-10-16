import { afterAll, expect, test } from "bun:test";
import { assertCurrentMigrationLedger } from "../fixtures/migration-ledger";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DrizzleClosureRepository } from "@/server/db/repositories/academic-closure-repository";
import { DrizzleEvaluationRepository } from "@/server/db/repositories/evaluation-repository";
import { hasClosureActorActivity } from "@/server/academic-closure/actor-dependencies";
import { handleClosurePost } from "@/server/academic-closure/http";
import {
  loadAcademicClosure,
  loadAcademicClosureVersion,
} from "@/server/academic-closure/loaders";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createClosureFixture } from "../fixtures/academic-closure";
import { evaluationFixtureTables } from "../fixtures/evaluation-cleanup";
import type { InternalUser } from "@/domain/auth/types";
import { DrizzleCourseReportRepository } from "@/server/db/repositories/course-report-repository";
import { buildCourseReport } from "@/application/courses/course-report";

const connection = createDatabase(getTestSupabaseEnvironment().databaseUrl, {
  max: 8,
});
const db = connection.db;
let now = new Date("2099-02-01T12:00:00Z");
const clock = () => now;
const repo = new DrizzleClosureRepository(db, clock);
const evaluations = new DrizzleEvaluationRepository(db, clock);
afterAll(async () => {
  await db.execute(
    sql`truncate ${evaluationFixtureTables}, participant_attendance, instructor_attendance, session_roster, attendance_command_receipts, group_sessions, registration_ledger, registration_command_receipts, pre_registrations, participants restrict`,
  );
  await connection.close();
});
async function setup(withAttendance = false) {
  now = new Date("2099-02-01T12:00:00Z");
  const f = await createClosureFixture(db, clock);
  const components = withAttendance
    ? [
        { ...f.components[0]!, weight: "50" },
        {
          id: crypto.randomUUID(),
          name: "Asistencia",
          type: "ATTENDANCE" as const,
          weight: "50",
        },
      ]
    : f.components;
  await evaluations.saveScheme(f.admin.id, {
    courseId: f.course.id,
    requestKey: crypto.randomUUID(),
    schemeRevision: 0,
    components,
  });
  const groupId = f.groups[0]!.id;
  const command = {
    courseId: f.course.id,
    groupId,
    requestKey: crypto.randomUUID(),
    revision: 0,
  };
  const settings = await f.attendance.getSettings(f.admin.id);
  await f.attendance.updateSettings(f.admin.id, {
    requestKey: crypto.randomUUID(),
    revision: settings.revision,
    consecutiveAbsenceLimit: 1,
  });
  // A cancelled encounter is resolved; it must not be restored to close.
  const cancelled = f.calendar.sessions.at(-1)!;
  await f.attendance.cancel(f.admin.id, {
    ...command,
    sessionId: cancelled.id,
    revision: cancelled.revision,
    reason: "Synthetic cancellation",
  });
  return { ...f, components, command, groupId };
}
async function completeGrade(f: Awaited<ReturnType<typeof setup>>) {
  return evaluations.saveRow(f.instructor.id, {
    courseId: f.course.id,
    groupId: f.groupId,
    registrationId: f.paid.id,
    requestKey: crypto.randomUUID(),
    schemeRevision: 1,
    grades: [
      { componentId: f.components[0]!.id, gradeRevision: 0, score: "70" },
    ],
  });
}

test("academic closure lifecycle validates blockers, permissions and immutable historical official versions", async () => {
  const f = await setup();
  await expect(repo.close(f.instructor.id, f.command)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    repo.getGroup(f.foreign.id, f.course.id, f.groupId),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    repo.getGroup(f.admin.id, f.course.id, crypto.randomUUID()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  let state = await repo.getGroup(f.admin.id, f.course.id, f.groupId);
  expect(state.blockers).toContain("SESSIONS_UNFINISHED");
  now = new Date("2099-03-04T14:00:00Z");
  await expect(repo.close(f.instructor.id, f.command)).rejects.toMatchObject({
    code: "CLOSURE_BLOCKED",
  });
  expect(
    (await repo.getGroup(f.admin.id, f.course.id, f.groupId)).blockers,
  ).toEqual(["GRADES_PENDING", "ATTENDANCE_PENDING"]);
  await completeGrade(f);
  await expect(repo.close(f.admin.id, f.command)).rejects.toMatchObject({
    code: "CLOSURE_BLOCKED",
  });
  // Missing marks resolve as inferred absences after the civil day, never as new writes.
  now = new Date("2099-03-06T12:00:00Z");
  state = await repo.getGroup(f.instructor.id, f.course.id, f.groupId);
  expect(state).toMatchObject({
    status: "OPEN",
    canClose: true,
    official: null,
    history: [],
  });
  expect(state.provisional!.participants).toHaveLength(1);
  expect(state.provisional!.participants[0]).not.toHaveProperty("ci");
  expect(state.provisional!.participants[0]).not.toHaveProperty("balanceCents");
  expect(state.provisional!.participants[0]).toMatchObject({
    registrationId: f.paid.id,
    result: { passed: true },
    attendance: {
      absent: 3,
      maximumConsecutiveAbsences: 3,
      academicallyEligible: false,
    },
    academicallyPassed: false,
  });
  expect(await db.select().from(s.participantAttendance)).toHaveLength(0);
  const first = await repo.close(f.instructor.id, f.command);
  const courseReports = new DrizzleCourseReportRepository(db);
  const reportFilter = { search: f.course.slug, status: "ALL" as const };
  const closedReport = buildCourseReport(
    await courseReports.read(f.admin.id, reportFilter, now),
    reportFilter,
    now,
  );
  expect(closedReport.courses[0]!.groups[0]).toMatchObject({
    enrolled: 1,
    passed: 0,
    notPassed: 1,
  });
  expect(first).toMatchObject({ status: "CLOSED", revision: 1, version: 1 });
  expect(await repo.close(f.instructor.id, f.command)).toEqual(first);
  await expect(
    repo.close(f.instructor.id, { ...f.command, revision: 1 }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    repo.close(f.admin.id, { ...f.command, requestKey: crypto.randomUUID() }),
  ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
  const original = await repo.getVersion(f.admin.id, f.course.id, f.groupId, 1);
  expect(original).toMatchObject({
    actorId: f.instructor.id,
    actorName: f.instructor.name,
    report: {
      minimumGrade: 70,
      attendanceSettings: { consecutiveAbsenceLimit: 1 },
    },
  });
  expect(original.report.participants.map((p) => p.registrationId)).toEqual([
    f.paid.id,
  ]);
  // The unpaid registration/balance remains intact and does not block closure.
  expect(
    (
      await db
        .select()
        .from(s.preRegistrations)
        .where(eq(s.preRegistrations.id, f.unpaid.id))
    )[0]!.state,
  ).toBe("ACTIVE");
  const closedGrade = {
    courseId: f.course.id,
    registrationId: f.paid.id,
    requestKey: crypto.randomUUID(),
    schemeRevision: 2,
    componentId: f.components[0]!.id,
    gradeRevision: 1,
    score: "100",
  };
  await expect(
    evaluations.saveGrade(f.admin.id, closedGrade),
  ).rejects.toMatchObject({ code: "GROUP_CLOSED" });
  await expect(
    evaluations.saveRow(f.instructor.id, {
      ...closedGrade,
      requestKey: crypto.randomUUID(),
      grades: [
        {
          componentId: closedGrade.componentId,
          gradeRevision: 1,
          score: "100",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "GROUP_CLOSED" });
  const selected = f.calendar.sessions[0]!;
  const attendanceCommand = {
    ...f.command,
    requestKey: crypto.randomUUID(),
    sessionId: selected.id,
    revision: selected.revision,
  };
  await expect(
    f.attendance.record(f.admin.id, {
      ...attendanceCommand,
      marks: [{ registrationId: f.paid.id, status: "PRESENT" }],
    }),
  ).rejects.toMatchObject({ code: "GROUP_CLOSED" });
  await expect(
    f.attendance.cancel(f.admin.id, attendanceCommand),
  ).rejects.toMatchObject({ code: "GROUP_CLOSED" });
  await expect(
    f.attendance.replace(f.admin.id, {
      ...attendanceCommand,
      startsAt: "2099-03-07T08:00",
    }),
  ).rejects.toMatchObject({ code: "GROUP_CLOSED" });
  const reopen = {
    ...f.command,
    requestKey: crypto.randomUUID(),
    revision: 1,
    reason: "Corrección documentada",
  };
  await expect(repo.reopen(f.instructor.id, reopen)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    repo.reopen(f.admin.id, { ...reopen, reason: "bad\nreason" }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await db
    .update(s.users)
    .set({ name: "Renamed synthetic actor" })
    .where(eq(s.users.id, f.instructor.id));
  await db
    .update(s.courses)
    .set({ minimumGrade: 90 })
    .where(eq(s.courses.id, f.course.id));
  const settings = await f.attendance.getSettings(f.admin.id);
  await f.attendance.updateSettings(f.admin.id, {
    requestKey: crypto.randomUUID(),
    revision: settings.revision,
    consecutiveAbsenceLimit: 10,
  });
  expect(await repo.getVersion(f.admin.id, f.course.id, f.groupId, 1)).toEqual(
    original,
  );
  const closedEvaluations = await evaluations.getCourse(
    f.instructor.id,
    f.course.id,
    f.groupId,
  );
  expect(closedEvaluations).toMatchObject({
    provisional: false,
    minimumGrade: 70,
    participants: [{ canGrade: false, result: { passed: true } }],
  });
  const closedAttendance = await f.attendance.getSession(
    f.admin.id,
    f.course.id,
    f.groupId,
    selected.id,
  );
  expect(closedAttendance.group.settings.consecutiveAbsenceLimit).toBe(1);
  expect(closedAttendance.session.canRecord).toBe(false);
  expect(closedAttendance.participants[0]!.academicallyEligible).toBe(false);
  expect(closedAttendance.reviewCandidates).toEqual([]);
  const reopened = await repo.reopen(f.admin2.id, reopen);
  expect(reopened).toMatchObject({ status: "OPEN", revision: 2, version: 1 });
  const reopenedReport = buildCourseReport(
    await courseReports.read(f.admin.id, reportFilter, now),
    reportFilter,
    now,
  );
  expect(reopenedReport.courses[0]!.groups[0]).toMatchObject({
    enrolled: 1,
    passed: null,
    notPassed: null,
  });
  expect(await repo.reopen(f.admin2.id, reopen)).toEqual(reopened);
  state = await repo.getGroup(f.admin.id, f.course.id, f.groupId);
  expect(state.official).toBeNull();
  expect(state.history).toHaveLength(1);
  expect(state.reopenings[0]).toMatchObject({
    actorId: f.admin2.id,
    reason: reopen.reason,
  });
  await expect(
    evaluations.saveScheme(f.admin.id, {
      courseId: f.course.id,
      requestKey: crypto.randomUUID(),
      schemeRevision: 2,
      components: f.components,
    }),
  ).rejects.toMatchObject({ code: "SCHEME_FROZEN" });
  await evaluations.saveGrade(f.admin.id, closedGrade);
  await f.attendance.record(f.admin.id, {
    ...attendanceCommand,
    marks: [{ registrationId: f.paid.id, status: "PRESENT" }],
  });
  const nextCommand = {
    ...f.command,
    requestKey: crypto.randomUUID(),
    revision: 2,
  };
  const next = await repo.close(f.admin2.id, nextCommand);
  expect(next).toMatchObject({ version: 2, revision: 3, status: "CLOSED" });
  const official = await repo.getVersion(f.admin.id, f.course.id, f.groupId, 2);
  const currentReport = buildCourseReport(
    await courseReports.read(f.admin.id, reportFilter, now),
    reportFilter,
    now,
  );
  expect(currentReport.courses[0]!.groups[0]).toMatchObject({
    enrolled: 1,
    passed: 1,
    notPassed: 0,
  });
  await expect(
    repo.getVersion(f.instructor.id, f.course.id, f.groupId, 1),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await repo.getVersion(f.instructor.id, f.course.id, f.groupId, 2),
  ).toMatchObject({ version: 2, report: { access: "INSTRUCTOR" } });
  expect(
    await repo.getGroup(f.instructor.id, f.course.id, f.groupId),
  ).toMatchObject({ history: [], reopenings: [] });
  expect(official.actorId).toBe(f.admin2.id);
  expect(official.report).toMatchObject({
    minimumGrade: 90,
    attendanceSettings: { consecutiveAbsenceLimit: 10 },
    participants: [
      { result: { finalGrade: "100.00" }, academicallyPassed: true },
    ],
  });
  expect(await repo.getVersion(f.admin.id, f.course.id, f.groupId, 1)).toEqual(
    original,
  );
  // Another group of the course is still provisional and writable.
  const other = await evaluations.saveGrade(f.instructor.id, {
    ...closedGrade,
    requestKey: crypto.randomUUID(),
    registrationId: f.otherGroup.id,
    groupId: f.groups[1]!.id,
    gradeRevision: 0,
  });
  expect(other.kind).toBe("grade");
  expect(
    (await evaluations.getCourse(f.admin.id, f.course.id, f.groups[1]!.id))
      .provisional,
  ).toBe(true);
  const audit = await db
    .select()
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.entityId, f.groupId),
        eq(s.auditEvents.action, "ACADEMIC_GROUP_REOPENED"),
      ),
    );
  expect(audit).toHaveLength(1);
  expect(audit[0]!.actorId).toBe(f.admin2.id);
  expect(
    await db.transaction((tx) => hasClosureActorActivity(tx, f.admin2.id)),
  ).toBe(true);
  expect(
    await db.transaction((tx) => hasClosureActorActivity(tx, f.foreign.id)),
  ).toBe(false);
  await db
    .update(s.users)
    .set({ status: "DISABLED" })
    .where(eq(s.users.id, f.admin2.id));
  await expect(repo.close(f.admin2.id, nextCommand)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
async function attendanceGradeLifecycle() {
  now = new Date("2099-02-01T12:00:00Z");
  const f = await createClosureFixture(db, clock);
  const courseId = f.course.id,
    groupId = f.groups[0]!.id;
  const components = [
    {
      id: crypto.randomUUID(),
      name: "Asistencia",
      type: "ATTENDANCE" as const,
      weight: "25",
    },
    {
      id: crypto.randomUUID(),
      name: "Asistencia adicional",
      type: "ATTENDANCE" as const,
      weight: "25",
    },
    {
      id: crypto.randomUUID(),
      name: "Asistencia",
      type: "THEORY" as const,
      weight: "50",
    },
  ];
  await evaluations.saveScheme(f.admin.id, {
    courseId,
    requestKey: crypto.randomUUID(),
    schemeRevision: 0,
    components,
  });
  let data = await evaluations.getCourse(f.admin.id, courseId, groupId);
  await f.attendance.cancel(f.admin.id, {
    courseId,
    groupId,
    sessionId: f.calendar.sessions[3]!.id,
    revision: f.calendar.sessions[3]!.revision,
    requestKey: crypto.randomUUID(),
    reason: "Synthetic cancelled encounter",
  });
  await f.attendance.replace(f.admin.id, {
    courseId,
    groupId,
    sessionId: f.calendar.sessions[2]!.id,
    revision: f.calendar.sessions[2]!.revision,
    requestKey: crypto.randomUUID(),
    startsAt: "2099-03-10T08:00",
  });
  expect(data.scheme.frozenAt).toBeNull();
  expect(data.hasAttendanceOverrides).toBe(false);
  expect(data.participants).toHaveLength(0);
  now = new Date("2099-03-02T12:00:00Z");
  data = await evaluations.getCourse(f.admin.id, courseId, groupId);
  let person = data.participants.find((p) => p.registrationId === f.paid.id)!;
  expect(person.grades[0]).toMatchObject({
    score: null,
    canEdit: false,
    origin: "AUTO",
  });
  const command = {
    courseId,
    groupId,
    schemeRevision: 1,
    requestKey: crypto.randomUUID(),
  };
  await expect(
    evaluations.saveGrade(f.instructor.id, {
      ...command,
      registrationId: f.paid.id,
      componentId: components[0]!.id,
      gradeRevision: 0,
      score: "100",
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const first = f.calendar.sessions[0]!;
  await f.attendance.record(f.instructor.id, {
    courseId,
    groupId,
    sessionId: first.id,
    revision: first.revision,
    requestKey: crypto.randomUUID(),
    marks: [{ registrationId: f.paid.id, status: "EXCUSED" }],
  });
  data = await evaluations.getCourse(f.admin.id, courseId, groupId);
  expect(
    data.participants.find((p) => p.registrationId === f.paid.id)!.grades[0],
  ).toMatchObject({ score: "100.00", canEdit: false });
  expect(data.scheme.frozenAt).toBeNull();
  expect(
    await db
      .select()
      .from(s.evaluationGrades)
      .where(eq(s.evaluationGrades.courseId, courseId)),
  ).toHaveLength(0);
  now = new Date("2099-03-03T03:59:59Z");
  expect(
    (await evaluations.getCourse(f.admin.id, courseId, groupId))
      .participants[0]!.grades[0]!.score,
  ).toBe("100.00");
  now = new Date("2099-03-06T12:00:00Z");
  data = await evaluations.getCourse(f.instructor.id, courseId, groupId);
  expect(data.participants[0]!.grades[0]).toMatchObject({
    score: "50.00",
    canEdit: false,
  });
  expect(
    (await repo.getGroup(f.admin.id, courseId, groupId)).blockers,
  ).toContain("SESSIONS_UNFINISHED");
  now = new Date("2099-03-11T12:00:00Z");
  data = await evaluations.getCourse(f.instructor.id, courseId, groupId);
  person = data.participants.find((p) => p.registrationId === f.paid.id)!;
  expect(person.grades[0]).toMatchObject({
    score: "33.33",
    canEdit: true,
    revision: 0,
  });
  expect(person.grades[1]!.score).toBe("33.33");
  // No GET, including the closure read, may persist/freeze an automatic grade.
  await repo.getGroup(f.admin.id, courseId, groupId);
  expect(
    (await evaluations.getCourse(f.admin.id, courseId, groupId)).scheme
      .frozenAt,
  ).toBeNull();
  const saved = await evaluations.saveRow(f.instructor.id, {
    ...command,
    registrationId: f.paid.id,
    grades: [
      { componentId: components[0]!.id, gradeRevision: 0, score: "0" },
      { componentId: components[2]!.id, gradeRevision: 0, score: "80" },
    ],
  });
  expect(saved).toMatchObject({ kind: "row", result: { finalGrade: "48.33" } });
  data = await evaluations.getCourse(f.admin.id, courseId, groupId);
  expect(data.scheme.frozenAt).not.toBeNull();
  expect(data.hasAttendanceOverrides).toBe(true);
  await evaluations.saveGrade(f.admin.id, {
    courseId,
    groupId: f.groups[1]!.id,
    schemeRevision: data.scheme.revision,
    requestKey: crypto.randomUUID(),
    registrationId: f.otherGroup.id,
    componentId: components[0]!.id,
    gradeRevision: 0,
    score: "88",
  });
  const reset = {
    ...command,
    schemeRevision: data.scheme.revision,
    requestKey: crypto.randomUUID(),
  };
  await expect(
    evaluations.resetAttendance(f.foreign.id, reset),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const snapshot = await repo.close(f.instructor.id, {
    courseId,
    groupId,
    requestKey: crypto.randomUUID(),
    revision: 0,
  });
  expect(snapshot.status).toBe("CLOSED");
  await expect(
    evaluations.resetAttendance(f.admin.id, reset),
  ).rejects.toMatchObject({ code: "GROUP_CLOSED" });
  const original = await repo.getVersion(f.admin.id, courseId, groupId, 1);
  expect(original.report.participants[0]!.grades.map((g) => g.score)).toEqual([
    "0.00",
    "33.33",
    "80.00",
  ]);
  const persisted = await db
    .select()
    .from(s.evaluationGrades)
    .where(eq(s.evaluationGrades.courseId, courseId));
  expect(
    persisted.find((g) => g.componentId === components[1]!.id)!.origin,
  ).toBe("AUTO");
  await repo.reopen(f.admin.id, {
    courseId,
    groupId,
    requestKey: crypto.randomUUID(),
    revision: 1,
  });
  await f.attendance.record(f.admin.id, {
    courseId,
    groupId,
    sessionId: first.id,
    revision: first.revision + 1,
    requestKey: crypto.randomUUID(),
    marks: [{ registrationId: f.paid.id, status: "ABSENT" }],
  });
  data = await evaluations.getCourse(f.instructor.id, courseId, groupId);
  person = data.participants.find((p) => p.registrationId === f.paid.id)!;
  expect(person.grades.map((g) => g.score)).toEqual(["0.00", "0.00", "80.00"]);
  expect(person.grades[0]!.origin).toBe("MANUAL");
  const result = await evaluations.resetAttendance(f.instructor.id, reset);
  expect(await evaluations.resetAttendance(f.instructor.id, reset)).toEqual(
    result,
  );
  data = await evaluations.getCourse(f.admin.id, courseId, groupId);
  expect(data.hasAttendanceOverrides).toBe(false);
  const otherGroup = await evaluations.getCourse(
    f.admin.id,
    courseId,
    f.groups[1]!.id,
  );
  expect(otherGroup.hasAttendanceOverrides).toBe(true);
  expect(otherGroup.participants[0]!.grades[0]).toMatchObject({
    origin: "MANUAL",
    score: "88.00",
  });
  expect(data.participants[0]!.grades[2]).toMatchObject({
    score: "80.00",
    origin: "MANUAL",
  });
  expect(await repo.getVersion(f.admin.id, courseId, groupId, 1)).toEqual(
    original,
  );
  expect(
    (
      await db
        .select()
        .from(s.auditEvents)
        .where(
          and(
            eq(s.auditEvents.entityId, courseId),
            eq(s.auditEvents.action, "EVALUATION_ATTENDANCE_GRADE_RECORDED"),
          ),
        )
    ).some(
      (a) =>
        a.metadata.fromOrigin === "MANUAL" && a.metadata.toOrigin === "AUTO",
    ),
  ).toBe(true);
}

test("academic closure privacy projects open, official and historical loaders using fresh actor roles and ownership", async () => {
  const f = await setup();
  now = new Date("2099-03-06T12:00:00Z");
  await completeGrade(f);
  const instructor = {
    actor: f.instructor,
    repository: repo,
    courseId: f.course.id,
    groupId: f.groupId,
  };
  const admin = {
    ...instructor,
    actor: { ...f.admin, roles: ["ADMIN" as const] },
  };
  function privateOutput(value: unknown) {
    const json = JSON.stringify(value);
    expect(json).not.toMatch(
      /"(?:ci|email|phone|balanceCents|participantType|minimumPaymentCents|totalPriceCents|ledger)":/u,
    );
    expect(json).not.toContain(f.paid.participant.ci);
    expect(json).not.toContain(f.paid.participant.email);
  }
  const open = await loadAcademicClosure(instructor);
  expect(open).toMatchObject({
    available: true,
    data: {
      status: "OPEN",
      provisional: {
        access: "INSTRUCTOR",
        participants: [
          { firstName: "Synthetic", result: { status: "COMPLETE" } },
        ],
      },
    },
  });
  privateOutput(open);
  const adminOpen = await loadAcademicClosure(admin);
  expect(adminOpen).toMatchObject({
    available: true,
    data: {
      provisional: {
        access: "ADMIN",
        participants: [{ ci: f.paid.participant.ci, balanceCents: 0 }],
      },
    },
  });
  const posted = await handleClosurePost({
    ...instructor,
    siteUrl: new URL("http://127.0.0.1:44895"),
    operation: "close",
    request: new Request("http://127.0.0.1:44895", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:44895",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestKey: f.command.requestKey, revision: 0 }),
    }),
  });
  expect(posted).toMatchObject({
    status: 200,
    payload: { ok: true, value: { status: "CLOSED", version: 1 } },
  });
  privateOutput(posted);
  const [stored] = await db
    .select()
    .from(s.academicClosureVersions)
    .where(eq(s.academicClosureVersions.groupId, f.groupId));
  expect(stored!.report.participants[0]!.ci).toBe(f.paid.participant.ci);
  expect(stored!.report).not.toHaveProperty("access");
  const storedJson = JSON.stringify(stored!.report);
  const closed = await loadAcademicClosure(instructor);
  expect(closed).toMatchObject({
    available: true,
    data: {
      status: "CLOSED",
      official: { report: { access: "INSTRUCTOR" } },
      history: [],
      reopenings: [],
    },
  });
  privateOutput(closed);
  expect(
    await loadAcademicClosureVersion({ ...instructor, version: 1 }),
  ).toMatchObject({
    available: true,
    data: { version: 1, report: { access: "INSTRUCTOR" } },
  });
  expect(await loadAcademicClosure(admin)).toMatchObject({
    available: true,
    data: {
      official: {
        report: {
          access: "ADMIN",
          participants: [{ ci: f.paid.participant.ci }],
        },
      },
    },
  });
  const privacyReopen = {
    ...f.command,
    requestKey: crypto.randomUUID(),
    revision: 1,
    reason: "   ",
  };
  const reopening = await repo.reopen(f.admin2.id, privacyReopen);
  expect(
    await repo.reopen(f.admin2.id, { ...privacyReopen, reason: null }),
  ).toEqual(reopening);
  expect(
    (await repo.getGroup(f.admin.id, f.course.id, f.groupId)).reopenings[0]!
      .reason,
  ).toBeNull();
  expect(
    (
      await db
        .select()
        .from(s.auditEvents)
        .where(
          and(
            eq(s.auditEvents.entityId, f.groupId),
            eq(s.auditEvents.action, "ACADEMIC_GROUP_REOPENED"),
          ),
        )
    )[0]!.metadata,
  ).toMatchObject({ reason: null });
  const reopenedInstructor = await loadAcademicClosure(instructor);
  expect(reopenedInstructor).toMatchObject({
    available: true,
    data: { status: "OPEN", official: null, history: [], reopenings: [] },
  });
  privateOutput(reopenedInstructor);
  const historical = await loadAcademicClosureVersion({
    ...instructor,
    version: 1,
  });
  expect(historical).toMatchObject({
    available: false,
    status: 403,
    code: "FORBIDDEN",
  });
  expect(historical).not.toHaveProperty("data");
  privateOutput(historical);
  expect(
    await loadAcademicClosureVersion({ ...admin, version: 1 }),
  ).toMatchObject({
    available: true,
    data: {
      report: {
        access: "ADMIN",
        participants: [{ ci: f.paid.participant.ci }],
      },
    },
  });
  expect(
    JSON.stringify(
      (
        await db
          .select()
          .from(s.academicClosureVersions)
          .where(eq(s.academicClosureVersions.id, stored!.id))
      )[0]!.report,
    ),
  ).toBe(storedJson);
  expect(
    await loadAcademicClosure({ ...instructor, actor: f.foreign }),
  ).toMatchObject({ available: false, status: 404 });
  expect(
    await loadAcademicClosureVersion({
      ...instructor,
      actor: f.foreign,
      version: 1,
    }),
  ).toMatchObject({ available: false, status: 404 });
  await db.delete(s.userRoles).where(eq(s.userRoles.userId, f.instructor.id));
  expect(await loadAcademicClosure(instructor)).toMatchObject({
    available: false,
    status: 403,
  });
  expect(
    await loadAcademicClosureVersion({ ...instructor, version: 1 }),
  ).toMatchObject({ available: false, status: 403 });
  await db
    .insert(s.userRoles)
    .values({ userId: f.instructor.id, roleCode: "INSTRUCTOR" });
  await db
    .update(s.users)
    .set({ status: "DISABLED" })
    .where(eq(s.users.id, f.instructor.id));
  expect(await loadAcademicClosure(instructor)).toMatchObject({
    available: false,
    status: 403,
  });
  expect(
    await loadAcademicClosureVersion({ ...instructor, version: 1 }),
  ).toMatchObject({ available: false, status: 403 });
});

test("academic closure waits for explicit historical attendance review and never closes over a missing last grade", async () => {
  const f = await setup();
  now = new Date("2099-03-06T12:00:00Z");
  const selected = f.calendar.sessions[0]!;
  await db
    .update(s.groupSessions)
    .set({
      administrativeReviewRequired: true,
      revision: selected.revision + 1,
    })
    .where(eq(s.groupSessions.id, selected.id));
  await f.attendance.record(f.admin.id, {
    ...f.command,
    requestKey: crypto.randomUUID(),
    sessionId: selected.id,
    revision: selected.revision + 1,
    marks: [{ registrationId: f.paid.id, status: "PRESENT" }],
    instructorStatus: "PRESENT",
    reviewRegistrationIds: [f.paid.id],
  });
  let state = await repo.getGroup(f.admin.id, f.course.id, f.groupId);
  expect(state.blockers).toEqual(["GRADES_PENDING", "ATTENDANCE_PENDING"]);
  await f.attendance.record(f.admin.id, {
    ...f.command,
    requestKey: crypto.randomUUID(),
    sessionId: selected.id,
    revision: selected.revision + 2,
    marks: [],
    reviewRegistrationIds: [f.paid.id],
    completeAdministrativeReview: true,
  });
  const outcomes = await Promise.allSettled([
    repo.close(f.admin.id, f.command),
    completeGrade(f),
  ]);
  expect(outcomes[1]!.status).toBe("fulfilled");
  if (outcomes[0]!.status === "rejected") {
    expect(outcomes[0]!.reason).toMatchObject({ code: "CLOSURE_BLOCKED" });
    state = await repo.getGroup(f.admin.id, f.course.id, f.groupId);
    expect(state).toMatchObject({
      status: "OPEN",
      history: [],
      revision: 0,
      blockers: [],
    });
    await repo.close(f.admin.id, f.command);
  }
  const official = await repo.getVersion(f.admin.id, f.course.id, f.groupId, 1);
  expect(official.report.participants[0]!.result).toMatchObject({
    status: "COMPLETE",
    finalGrade: "70.00",
    missingComponentIds: [],
  });
  expect(official.report.sessions[0]!.administrativeReviewRequired).toBe(false);
  expect(
    official.report.sessions[0]!.participants[0]!.attendance,
  ).toMatchObject({ status: "PRESENT", inferred: false, markedBy: f.admin.id });
  await attendanceGradeLifecycle();
});

test("academic closure transactions serialize close with grade and attendance writes and competing revisions", async () => {
  const f = await setup(true);
  now = new Date("2099-03-06T12:00:00Z");
  await completeGrade(f);
  const selected = f.calendar.sessions[0]!;
  const gradeInput = {
    courseId: f.course.id,
    registrationId: f.paid.id,
    requestKey: crypto.randomUUID(),
    schemeRevision: 2,
    componentId: f.components[0]!.id,
    gradeRevision: 1,
    score: "95",
  };
  const markInput = {
    ...f.command,
    requestKey: crypto.randomUUID(),
    sessionId: selected.id,
    revision: selected.revision,
    marks: [{ registrationId: f.paid.id, status: "PRESENT" as const }],
  };
  const outcomes = await Promise.allSettled([
    evaluations.saveGrade(f.admin.id, gradeInput),
    f.attendance.record(f.admin.id, markInput),
    repo.close(f.instructor.id, f.command),
  ]);
  expect(outcomes[2]!.status).toBe("fulfilled");
  const official = await repo.getVersion(f.admin.id, f.course.id, f.groupId, 1);
  expect(official.report.participants[0]!.grades.map((g) => g.score)).toEqual([
    outcomes[0]!.status === "fulfilled" ? "95.00" : "70.00",
    outcomes[1]!.status === "fulfilled" ? "33.33" : "0.00",
  ]);
  expect(
    official.report.sessions.find((session) => session.id === selected.id)!
      .participants[0]!.attendance.status,
  ).toBe(outcomes[1]!.status === "fulfilled" ? "PRESENT" : "ABSENT");
  for (const outcome of outcomes.slice(0, 2))
    if (outcome.status === "rejected")
      expect(outcome.reason).toMatchObject({ code: "GROUP_CLOSED" });
  await repo.reopen(f.admin.id, {
    ...f.command,
    requestKey: crypto.randomUUID(),
    revision: 1,
    reason: "QA competition",
  });
  await evaluations.saveGrade(f.admin.id, {
    ...gradeInput,
    requestKey: crypto.randomUUID(),
    componentId: f.components[1]!.id,
    gradeRevision: 1,
    score: "80",
  });
  const reset = {
    courseId: f.course.id,
    groupId: f.groupId,
    schemeRevision: 2,
    requestKey: crypto.randomUUID(),
  };
  const competing = await Promise.allSettled([
    repo.close(f.admin.id, {
      ...f.command,
      requestKey: crypto.randomUUID(),
      revision: 2,
    }),
    repo.close(f.admin2.id, {
      ...f.command,
      requestKey: crypto.randomUUID(),
      revision: 2,
    }),
    evaluations.resetAttendance(f.instructor.id, reset),
  ]);
  expect(
    competing.slice(0, 2).filter((r) => r.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    competing.slice(0, 2).filter((r) => r.status === "rejected")[0],
  ).toMatchObject({
    reason: { code: "CONCURRENT_UPDATE" },
  });
  const latest = await repo.getVersion(f.admin.id, f.course.id, f.groupId, 2);
  expect(latest.report.participants[0]!.grades[1]!.score).toBe(
    competing[2]!.status === "fulfilled"
      ? official.report.participants[0]!.grades[1]!.score
      : "80.00",
  );
  if (competing[2]!.status === "rejected")
    expect(competing[2]!.reason).toMatchObject({ code: "GROUP_CLOSED" });
  expect(
    (await repo.getGroup(f.admin.id, f.course.id, f.groupId)).history.map(
      (v) => v.version,
    ),
  ).toEqual([2, 1]);
  expect(await repo.getVersion(f.admin.id, f.course.id, f.groupId, 1)).toEqual(
    official,
  );
});

test("academic closure private HTTP and database guards preserve snapshots and deny alternate evidence mutations", async () => {
  const f = await setup();
  now = new Date("2099-03-06T12:00:00Z");
  await completeGrade(f);
  const actor: InternalUser = { ...f.admin, roles: ["ADMIN", "INSTRUCTOR"] };
  const input = {
    actor,
    repository: repo,
    siteUrl: new URL("http://127.0.0.1:44895"),
    operation: "close" as const,
    courseId: f.course.id,
    groupId: f.groupId,
  };
  const request = new Request(input.siteUrl, {
    method: "POST",
    headers: {
      Origin: input.siteUrl.origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requestKey: f.command.requestKey, revision: 0 }),
  });
  expect((await handleClosurePost({ ...input, request })).status).toBe(200);
  const loaded = await loadAcademicClosure(input);
  expect(loaded).toMatchObject({
    available: true,
    data: { status: "CLOSED", revision: 1 },
  });
  expect(
    await loadAcademicClosureVersion({ ...input, version: 99 }),
  ).toMatchObject({ available: false, status: 404 });
  const selected = f.calendar.sessions[0]!;
  await expect(
    db
      .update(s.groupSessions)
      .set({ revision: selected.revision + 1 })
      .where(eq(s.groupSessions.id, selected.id))
      .execute(),
  ).rejects.toMatchObject({
    cause: { code: "23514", message: expect.stringContaining("closed") },
  });
  await expect(
    db
      .insert(s.participantAttendance)
      .values({
        sessionId: selected.id,
        registrationId: f.paid.id,
        status: "PRESENT",
        markedBy: f.admin.id,
        markedAt: now,
      })
      .execute(),
  ).rejects.toMatchObject({
    cause: { code: "23514", message: expect.stringContaining("closed") },
  });
  await expect(
    db
      .insert(s.instructorAttendance)
      .values({
        sessionId: selected.id,
        instructorId: f.instructor.id,
        status: "PRESENT",
        markedBy: f.admin.id,
        markedAt: now,
      })
      .execute(),
  ).rejects.toMatchObject({
    cause: { code: "23514", message: expect.stringContaining("closed") },
  });
  await expect(
    db
      .insert(s.sessionRoster)
      .values({
        sessionId: selected.id,
        registrationId: f.otherGroup.id,
        establishedAt: now,
      })
      .execute(),
  ).rejects.toMatchObject({
    cause: { code: "23514", message: expect.stringContaining("closed") },
  });
  await expect(
    db
      .update(s.evaluationGrades)
      .set({ scoreHundredths: 10000, revision: 2 })
      .where(
        and(
          eq(s.evaluationGrades.courseId, f.course.id),
          eq(s.evaluationGrades.participantId, f.paid.participant.id),
        ),
      )
      .execute(),
  ).rejects.toMatchObject({
    cause: { code: "23514", message: expect.stringContaining("closed") },
  });
  const [version] = await db
    .select()
    .from(s.academicClosureVersions)
    .where(eq(s.academicClosureVersions.groupId, f.groupId));
  await expect(
    db
      .update(s.academicClosureVersions)
      .set({ actorName: "altered" })
      .where(eq(s.academicClosureVersions.id, version!.id))
      .execute(),
  ).rejects.toMatchObject({
    cause: { code: "23514", message: expect.stringContaining("immutable") },
  });
  await expect(
    db
      .delete(s.academicClosureVersions)
      .where(eq(s.academicClosureVersions.id, version!.id))
      .execute(),
  ).rejects.toMatchObject({
    cause: { code: "23514", message: expect.stringContaining("immutable") },
  });
  const [receipt] = await db
    .select()
    .from(s.academicClosureReceipts)
    .where(eq(s.academicClosureReceipts.requestKey, f.command.requestKey));
  await expect(
    db
      .update(s.academicClosureReceipts)
      .set({ fingerprint: "a".repeat(64) })
      .where(eq(s.academicClosureReceipts.id, receipt!.id))
      .execute(),
  ).rejects.toMatchObject({
    cause: { code: "23514", message: expect.stringContaining("immutable") },
  });
  await repo.reopen(f.admin.id, {
    ...f.command,
    requestKey: crypto.randomUUID(),
    revision: 1,
    reason: "Check immutable reopening",
  });
  const [reopening] = await db
    .select()
    .from(s.academicGroupReopenings)
    .where(eq(s.academicGroupReopenings.versionId, version!.id));
  await expect(
    db
      .update(s.academicGroupReopenings)
      .set({ reason: "altered" })
      .where(eq(s.academicGroupReopenings.id, reopening!.id))
      .execute(),
  ).rejects.toMatchObject({
    cause: { code: "23514", message: expect.stringContaining("immutable") },
  });
  const security = await db.execute<{
    name: string;
    rls: boolean;
    anon: boolean;
    authenticated: boolean;
    service: boolean;
  }>(
    sql`select c.relname as name, c.relrowsecurity as rls, has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon, has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as authenticated, has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as service from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('academic_group_states','academic_closure_versions','academic_group_reopenings','academic_closure_receipts')`,
  );
  expect(security).toHaveLength(4);
  for (const row of security)
    expect(row).toMatchObject({
      rls: true,
      anon: false,
      authenticated: false,
      service: false,
    });
  const functions = await db.execute<{ granted: boolean }>(
    sql`select has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE') as granted from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('guard_academic_closure_history','guard_closed_academic_evidence')`,
  );
  expect(functions).toHaveLength(2);
  expect(functions.every((r) => !r.granted)).toBe(true);
  await assertCurrentMigrationLedger(db);
  const beforeReplay = await db
    .select()
    .from(s.academicClosureVersions)
    .orderBy(s.academicClosureVersions.id);
  const attendanceMigration = await Bun.file(
    new URL("../../drizzle/0029_attendance_grade.sql", import.meta.url),
  ).text();
  for (const statement of attendanceMigration.split("--> statement-breakpoint"))
    if (statement.trim()) await db.execute(sql.raw(statement));
  expect(
    await db
      .select()
      .from(s.academicClosureVersions)
      .orderBy(s.academicClosureVersions.id),
  ).toEqual(beforeReplay);
  await assertCurrentMigrationLedger(db);
  const originFunction = await db.execute<{ granted: boolean }>(
    sql`select has_function_privilege('anon', 'public.record_attendance_grade_origin()', 'EXECUTE') or has_function_privilege('authenticated', 'public.record_attendance_grade_origin()', 'EXECUTE') or has_function_privilege('service_role', 'public.record_attendance_grade_origin()', 'EXECUTE') as granted`,
  );
  expect(originFunction[0]!.granted).toBe(false);
  // Revoked current roles also deny loader access despite a stale ADMIN DTO.
  await db
    .delete(s.userRoles)
    .where(
      and(
        eq(s.userRoles.userId, f.admin.id),
        eq(s.userRoles.roleCode, "ADMIN"),
      ),
    );
  expect(
    await loadAcademicClosure({
      ...input,
      actor: { ...actor, roles: ["ADMIN"] },
    }),
  ).toMatchObject({ available: false, status: 404 });
});
