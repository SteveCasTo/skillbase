import { afterAll, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DrizzleEvaluationRepository } from "@/server/db/repositories/evaluation-repository";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";
import { DrizzleAttendanceRepository } from "@/server/db/repositories/attendance-repository";
import { handleEvaluationPost } from "@/server/evaluations/http";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createInstructorFixture } from "../fixtures/instructors";
import { evaluationFixtureTables } from "../fixtures/evaluation-cleanup";
const connection = createDatabase(getTestSupabaseEnvironment().databaseUrl, {
  max: 8,
});
const db = connection.db;
let now = new Date("2099-02-01T12:00:00Z");
const repo = new DrizzleEvaluationRepository(db, () => now);
const finance = createRegistrationRepository(db, () => now);
afterAll(async () => {
  // Verified isolated QA: also remove this suite's financial fixtures, not just
  // its evaluation rows, so later renewal tests do not inherit synthetic history.
  await db.execute(
    sql`truncate ${evaluationFixtureTables}, participant_attendance, instructor_attendance, session_roster, attendance_command_receipts, group_sessions, registration_ledger, registration_command_receipts, pre_registrations, participants restrict`,
  );
  await connection.close();
});
async function fixture() {
  const admin = await createInstructorFixture(db);
  await db.insert(s.userRoles).values({ userId: admin.id, roleCode: "ADMIN" });
  const instructor = await createInstructorFixture(db);
  const foreign = await createInstructorFixture(db);
  const [format] = await db
    .insert(s.courseTypes)
    .values({ name: `Evaluation ${crypto.randomUUID()}` })
    .returning();
  const [revision] = await db
    .insert(s.courseTypeRevisions)
    .values({
      courseTypeId: format!.id,
      revisionNumber: 1,
      totalHours: 6,
      sessionMinutes: 90,
      studentAmount: "80",
      externalAmount: "100",
    })
    .returning();
  const [course] = await db
    .insert(s.courses)
    .values({
      name: "Synthetic Evaluation Course",
      slug: `evaluation-${crypto.randomUUID()}`,
      description: "Only isolated QA",
      level: "BASIC",
      courseTypeRevisionId: revision!.id,
      instructorId: instructor.id,
      schedule: "Lunes a viernes",
      weekdaysMask: 31,
      conditions: "Synthetic",
      startsAt: new Date("2099-03-02T04:00:00Z"),
      endsAt: new Date("2099-03-05T23:59:00-04:00"),
      minimumGrade: 70,
      status: "PUBLISHED",
      updatedAt: now,
    })
    .returning();
  const groups = await db
    .insert(s.groups)
    .values(
      [8, 10].map((hour) => ({
        courseId: course!.id,
        courseTypeRevisionId: revision!.id,
        capacity: 10,
        startsAt: new Date(`2099-03-02T${hour + 4}:00:00Z`),
        endsAt: new Date(`2099-03-05T${hour + 5}:30:00Z`),
        publishedAt: now,
      })),
    )
    .returning();
  const settings = await finance.settings(admin.id);
  async function enroll(full: boolean, groupId = groups[0]!.id) {
    return finance.create(
      {
        requestKey: crypto.randomUUID(),
        courseId: course!.id,
        groupId,
        courseRevision: course!.updatedAt.toISOString(),
        settingsRevision: settings.revision,
        firstDayException: false,
        sourceInterestId: null,
        participantType: "STUDENT",
        participant: {
          ci: `EV-${crypto.randomUUID()}`,
          firstName: "Synthetic",
          lastName: crypto.randomUUID(),
          email: "private-evaluation@test.invalid",
          phone: "12345678",
        },
        initialPayment: {
          amountCents: full ? 8000 : 2000,
          effectiveDate: null,
          reason: "Synthetic",
        },
      },
      admin.id,
    );
  }
  const paid = await enroll(true),
    unpaid = await enroll(false),
    otherGroup = await enroll(true, groups[1]!.id);
  const components = ["THEORY", "PRACTICAL"].map((type) => ({
    id: crypto.randomUUID(),
    name: `Libre ${type}`,
    type: type as "THEORY" | "PRACTICAL",
    weight: "50.00",
  }));
  return {
    admin,
    instructor,
    foreign,
    course: course!,
    groups,
    paid,
    unpaid,
    otherGroup,
    components,
  };
}
test("evaluation row saves atomically with scoped authorization, revisions, exact results and one receipt", async () => {
  now = new Date("2099-02-01T12:00:00Z");
  const f = await fixture();
  await repo.saveScheme(f.admin.id, {
    courseId: f.course.id,
    requestKey: crypto.randomUUID(),
    schemeRevision: 0,
    components: f.components,
  });
  const row = {
    courseId: f.course.id,
    groupId: f.groups[0]!.id,
    registrationId: f.paid.id,
    requestKey: crypto.randomUUID(),
    schemeRevision: 1,
    grades: f.components.map((c) => ({
      componentId: c.id,
      gradeRevision: 0,
      score: "0",
    })),
  };
  await expect(repo.saveRow(f.instructor.id, row)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  now = new Date("2099-03-02T04:00:00Z");
  await expect(repo.saveRow(f.foreign.id, row)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    repo.saveRow(f.instructor.id, { ...row, registrationId: f.unpaid.id }),
  ).rejects.toMatchObject({ code: "NOT_ENROLLED" });
  await expect(
    repo.saveRow(f.admin.id, { ...row, groupId: f.groups[1]!.id }),
  ).rejects.toMatchObject({ code: "NOT_ENROLLED" });
  for (const bad of [
    { ...row, grades: [row.grades[0]!, { ...row.grades[1]!, score: "101" }] },
    {
      ...row,
      grades: [row.grades[0]!, { ...row.grades[1]!, gradeRevision: 1 }],
    },
    {
      ...row,
      grades: [
        row.grades[0]!,
        { ...row.grades[1]!, componentId: crypto.randomUUID() },
      ],
    },
  ])
    await expect(repo.saveRow(f.instructor.id, bad)).rejects.toThrow();
  let loaded = await repo.getCourse(f.admin.id, f.course.id);
  expect(loaded.scheme).toMatchObject({ revision: 1, frozenAt: null });
  expect(
    loaded.participants
      .find((p) => p.registrationId === f.paid.id)!
      .grades.every((g) => g.score === null),
  ).toBe(true);
  expect(
    await db
      .select()
      .from(s.evaluationCommandReceipts)
      .where(eq(s.evaluationCommandReceipts.requestKey, row.requestKey)),
  ).toHaveLength(0);
  const zero = await repo.saveRow(f.instructor.id, row);
  expect(zero).toMatchObject({
    kind: "row",
    schemeRevision: 2,
    result: { status: "COMPLETE", finalGrade: "0.00" },
  });
  expect(await repo.saveRow(f.instructor.id, row)).toEqual(zero);
  await expect(
    repo.saveRow(f.instructor.id, {
      ...row,
      grades: row.grades.map((g) => ({ ...g, score: "1" })),
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const correction = {
    ...row,
    requestKey: crypto.randomUUID(),
    schemeRevision: 2,
    grades: row.grades.map((g, i) => ({
      ...g,
      gradeRevision: 1,
      score: i ? "70" : "69.99",
    })),
  };
  await expect(
    repo.saveRow(f.admin.id, {
      ...correction,
      grades: [
        correction.grades[0]!,
        { ...correction.grades[1]!, gradeRevision: 0 },
      ],
    }),
  ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
  loaded = await repo.getCourse(f.admin.id, f.course.id);
  expect(
    loaded.participants
      .find((p) => p.registrationId === f.paid.id)!
      .grades.map((g) => g.score),
  ).toEqual(["0.00", "0.00"]);
  const saved = await repo.saveRow(f.admin.id, correction);
  expect(saved).toMatchObject({
    kind: "row",
    result: { finalGrade: "70.00", passed: true },
  });
  if (saved.kind !== "row") throw new Error("Expected row");
  expect(saved.grades.map((g) => g.recordedBy)).toEqual([
    f.admin.id,
    f.admin.id,
  ]);
  expect(saved.grades.map((g) => g.revision)).toEqual([2, 2]);
  const audit = await db
    .select()
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.entityId, f.course.id),
        eq(s.auditEvents.action, "EVALUATION_GRADE_RECORDED"),
      ),
    );
  expect(audit).toHaveLength(4);
  await expect(
    repo.saveRow(f.admin.id, {
      ...correction,
      requestKey: crypto.randomUUID(),
      schemeRevision: 1,
    }),
  ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
  const pending = await repo.saveRow(f.instructor.id, {
    ...row,
    requestKey: crypto.randomUUID(),
    schemeRevision: 2,
    groupId: f.groups[1]!.id,
    registrationId: f.otherGroup.id,
    grades: [row.grades[0]!],
  });
  expect(pending).toMatchObject({
    kind: "row",
    result: {
      status: "PENDING",
      finalGrade: null,
      missingComponentIds: [f.components[1]!.id],
    },
  });
  if (pending.kind !== "row") throw new Error("Expected row");
  expect(pending.grades.map((g) => g.score)).toEqual(["0.00", null]);
  await db
    .update(s.users)
    .set({ status: "DISABLED" })
    .where(eq(s.users.id, f.instructor.id));
  await expect(repo.saveRow(f.instructor.id, row)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    repo.saveScheme(f.admin.id, {
      courseId: f.course.id,
      requestKey: crypto.randomUUID(),
      schemeRevision: 2,
      components: f.components,
    }),
  ).rejects.toMatchObject({ code: "SCHEME_FROZEN" });
});
test("evaluation course scheme, zero freeze, corrections and provisional results preserve scoped membership, history and concurrent writes", async () => {
  now = new Date("2099-02-01T12:00:00Z");
  const f = await fixture();
  const command = {
    courseId: f.course.id,
    requestKey: crypto.randomUUID(),
    schemeRevision: 0,
    components: f.components,
  };
  expect((await repo.getCourse(f.admin.id, f.course.id)).scheme).toMatchObject({
    revision: 0,
    frozenAt: null,
    components: [],
  });
  await expect(repo.saveScheme(f.instructor.id, command)).rejects.toMatchObject(
    { code: "FORBIDDEN" },
  );
  await expect(repo.getCourse(f.foreign.id, f.course.id)).rejects.toMatchObject(
    { code: "NOT_FOUND" },
  );
  const saved = await repo.saveScheme(f.admin.id, command);
  expect(await repo.saveScheme(f.admin.id, command)).toEqual(saved);
  expect(
    (await repo.getCourse(f.admin.id, f.course.id)).participants,
  ).toHaveLength(0);
  await repo.saveScheme(f.admin.id, {
    ...command,
    requestKey: crypto.randomUUID(),
    schemeRevision: 1,
    components: f.components.map((c) => ({ ...c, name: `${c.name} editado` })),
  });
  await expect(
    db.transaction(async (tx) => {
      await tx
        .update(s.evaluationComponents)
        .set({ weightHundredths: 4999 })
        .where(eq(s.evaluationComponents.id, f.components[0]!.id));
    }),
  ).rejects.toThrow();
  now = new Date("2099-03-02T04:00:00Z");
  const shared = await repo.getCourse(
    f.instructor.id,
    f.course.id,
    f.groups[1]!.id,
  );
  expect(shared.scheme).toMatchObject({
    revision: 2,
    modality: "MIXED",
    canEdit: true,
  });
  expect(shared.participants.map((p) => p.registrationId)).toEqual([
    f.otherGroup.id,
  ]);
  await expect(
    repo.getCourse(f.admin.id, f.course.id, crypto.randomUUID()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    db.transaction(async (tx) => {
      await tx.insert(s.evaluationGrades).values({
        courseId: f.course.id,
        componentId: f.components[0]!.id,
        participantId: f.paid.participant.id,
        registrationId: f.paid.id,
        scoreHundredths: 0,
        recordedBy: f.instructor.id,
        recordedAt: now,
      });
      throw new Error("Synthetic rollback after first grade");
    }),
  ).rejects.toThrow("Synthetic rollback");
  expect((await repo.getCourse(f.admin.id, f.course.id)).scheme).toMatchObject({
    revision: 2,
    frozenAt: null,
    canEdit: true,
  });
  await expect(
    db
      .insert(s.evaluationGrades)
      .values({
        courseId: f.course.id,
        componentId: f.components[0]!.id,
        participantId: f.paid.participant.id,
        registrationId: f.unpaid.id,
        scoreHundredths: 0,
        recordedBy: f.admin.id,
        recordedAt: now,
      })
      .execute(),
  ).rejects.toThrow();
  const zero = {
    courseId: f.course.id,
    requestKey: crypto.randomUUID(),
    schemeRevision: 2,
    registrationId: f.paid.id,
    componentId: f.components[0]!.id,
    gradeRevision: 0,
    score: "0",
  };
  await expect(
    repo.saveGrade(f.instructor.id, { ...zero, registrationId: f.unpaid.id }),
  ).rejects.toMatchObject({ code: "NOT_ENROLLED" });
  await expect(
    repo.saveGrade(f.instructor.id, { ...zero, groupId: f.groups[1]!.id }),
  ).rejects.toMatchObject({ code: "NOT_ENROLLED" });
  const first = await repo.saveGrade(f.instructor.id, zero);
  expect(first).toMatchObject({
    kind: "grade",
    schemeRevision: 3,
    gradeRevision: 1,
    result: { status: "PENDING", finalGrade: null, decisionGrade: "0.00" },
  });
  expect(await repo.saveGrade(f.instructor.id, zero)).toEqual(first);
  await expect(
    repo.saveGrade(f.instructor.id, { ...zero, score: "1" }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    repo.saveScheme(f.admin.id, {
      ...command,
      requestKey: crypto.randomUUID(),
      schemeRevision: 3,
    }),
  ).rejects.toMatchObject({ code: "SCHEME_FROZEN" });
  const races = await Promise.allSettled(
    ["69.99", "70.00"].map((score) =>
      repo.saveGrade(f.admin.id, {
        ...zero,
        requestKey: crypto.randomUUID(),
        schemeRevision: 3,
        gradeRevision: 1,
        score,
      }),
    ),
  );
  expect(races.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(races.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "CONCURRENT_UPDATE" },
  });
  await repo.saveGrade(f.admin.id, {
    ...zero,
    requestKey: crypto.randomUUID(),
    schemeRevision: 3,
    gradeRevision: 2,
    score: "69,99",
  });
  const final = await repo.saveGrade(f.instructor.id, {
    ...zero,
    requestKey: crypto.randomUUID(),
    schemeRevision: 3,
    componentId: f.components[1]!.id,
    gradeRevision: 0,
    score: "70",
  });
  expect(final).toMatchObject({
    result: { status: "COMPLETE", finalGrade: "70.00", passed: true },
  });
  const [persisted] = await db
    .select()
    .from(s.evaluationResults)
    .where(
      and(
        eq(s.evaluationResults.courseId, f.course.id),
        eq(s.evaluationResults.participantId, f.paid.participant.id),
      ),
    );
  expect(persisted!.finalHundredths).toBe(7000);
  const instructorView = await repo.getCourse(f.instructor.id, f.course.id);
  expect(instructorView.history).toEqual([]);
  expect(
    instructorView.participants.every((p) =>
      p.grades.every((g) => g.recordedBy === null),
    ),
  ).toBe(true);
  expect(JSON.stringify(instructorView)).not.toContain(
    "private-evaluation@test.invalid",
  );
  expect(JSON.stringify(instructorView)).not.toContain("totalPriceCents");
  const adminView = await repo.getCourse(f.admin.id, f.course.id);
  expect(adminView.history).toHaveLength(4);
  expect(
    adminView.history!.some(
      (h) => h.fromScore === "0.00" && h.actorName === f.admin.name,
    ),
  ).toBe(true);
  const financesBefore = await finance.detail(f.paid.id, f.admin.id);
  const attendance = new DrizzleAttendanceRepository(db, () => now);
  const calendar = await attendance.getGroup(
    f.admin.id,
    f.course.id,
    f.groups[0]!.id,
  );
  now = new Date("2099-03-06T12:00:00Z");
  for (const session of calendar.sessions)
    await attendance.getSession(
      f.admin.id,
      f.course.id,
      f.groups[0]!.id,
      session.id,
    );
  expect(
    (
      await attendance.getSession(
        f.admin.id,
        f.course.id,
        f.groups[0]!.id,
        calendar.sessions[0]!.id,
      )
    ).participants[0]!.academicallyEligible,
  ).toBe(false);
  await repo.saveGrade(f.instructor.id, {
    ...zero,
    requestKey: crypto.randomUUID(),
    schemeRevision: 3,
    gradeRevision: 3,
    score: "80",
  });
  expect(await finance.detail(f.paid.id, f.admin.id)).toEqual(financesBefore);
  await expect(
    repo.saveGrade(f.admin.id, {
      ...zero,
      requestKey: crypto.randomUUID(),
      schemeRevision: 3,
      registrationId: f.unpaid.id,
    }),
  ).rejects.toMatchObject({ code: "NOT_ENROLLED" });
  await db
    .update(s.preRegistrations)
    .set({
      state: "CANCELLED",
      cancelledAt: now,
      cancelledBy: f.admin.id,
      cancellationReason: "VOLUNTARY",
      cancellationNote: "Synthetic lifecycle evidence",
      updatedAt: now,
    })
    .where(eq(s.preRegistrations.id, f.paid.id));
  expect(
    (await repo.getCourse(f.admin.id, f.course.id)).participants.find(
      (p) => p.registrationId === f.paid.id,
    ),
  ).toMatchObject({
    membershipStatus: "CANCELADO",
    canGrade: false,
    result: { status: "COMPLETE" },
  });
  await expect(
    repo.saveGrade(f.admin.id, {
      ...zero,
      requestKey: crypto.randomUUID(),
      schemeRevision: 3,
      gradeRevision: 4,
    }),
  ).rejects.toMatchObject({ code: "NOT_ENROLLED" });
  await db
    .update(s.users)
    .set({ status: "DISABLED" })
    .where(eq(s.users.id, f.instructor.id));
  const siteUrl = new URL("https://test.invalid");
  const denied = await handleEvaluationPost({
    actor: { ...f.instructor, roles: ["INSTRUCTOR"] },
    repository: repo,
    siteUrl,
    operation: "grade",
    courseId: f.course.id,
    request: new Request(siteUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: siteUrl.origin },
      body: JSON.stringify({
        ...zero,
        requestKey: crypto.randomUUID(),
        schemeRevision: 3,
        gradeRevision: 4,
      }),
    }),
  });
  expect(denied).toMatchObject({ status: 403, payload: { code: "FORBIDDEN" } });
  await expect(
    db
      .update(s.evaluationSchemes)
      .set({ frozenAt: null })
      .where(eq(s.evaluationSchemes.courseId, f.course.id))
      .execute(),
  ).rejects.toThrow();
  await expect(
    db
      .delete(s.evaluationGrades)
      .where(eq(s.evaluationGrades.courseId, f.course.id))
      .execute(),
  ).rejects.toThrow();
  await expect(
    db
      .update(s.evaluationComponents)
      .set({ weightHundredths: 10000 })
      .where(eq(s.evaluationComponents.id, f.components[0]!.id))
      .execute(),
  ).rejects.toThrow();
  const grants = await db.execute(
    sql`select relname, relrowsecurity, has_table_privilege('anon',oid,'SELECT') as anon_read, has_table_privilege('authenticated',oid,'INSERT') as client_write from pg_class where relnamespace = 'public'::regnamespace and relname like 'evaluation_%' and relkind = 'r'`,
  );
  expect(grants).toHaveLength(5);
  expect(
    grants.every((g) => g.relrowsecurity && !g.anon_read && !g.client_write),
  ).toBe(true);
});
