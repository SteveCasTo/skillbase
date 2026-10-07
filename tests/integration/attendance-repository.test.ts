import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DrizzleAttendanceRepository } from "@/server/db/repositories/attendance-repository";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";
import { DrizzleGroupRepository } from "@/server/db/repositories/group-repository";
import { handleAttendancePost } from "@/server/attendance/http";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createInstructorFixture } from "../fixtures/instructors";
import { evaluationFixtureTables } from "../fixtures/evaluation-cleanup";
const connection = createDatabase(getTestSupabaseEnvironment().databaseUrl, {
  max: 8,
});
const db = connection.db;
let now = new Date("2099-02-01T12:00:00Z");
const repo = new DrizzleAttendanceRepository(db, () => now);
const finance = createRegistrationRepository(db, () => now);
async function defaults() {
  await db
    .update(s.attendanceSettings)
    .set({ consecutiveAbsenceLimit: 3, revision: 1, updatedBy: null });
  await db.update(s.registrationSettings).set({
    minimumPaymentPercent: 25,
    auxiliaryDiscountPercent: 50,
    revision: 1,
    updatedBy: null,
  });
}
beforeEach(defaults);
afterEach(defaults);
afterAll(async () => {
  await db.execute(
    sql`truncate ${evaluationFixtureTables}, participant_attendance, instructor_attendance, session_roster, attendance_command_receipts, group_sessions, registration_ledger, registration_command_receipts, pre_registrations, participants restrict`,
  );
  await defaults();
  await connection.close();
});
async function fixture(options: { past?: boolean; hook?: boolean } = {}) {
  now = new Date(
    options.past ? "2099-03-05T12:00:00Z" : "2099-02-01T12:00:00Z",
  );
  const [admin] = await db
    .insert(s.users)
    .values({
      email: `attendance-${crypto.randomUUID()}@test.invalid`,
      name: "Synthetic Attendance Admin",
      authUserId: crypto.randomUUID(),
      status: "ACTIVE",
    })
    .returning();
  await db.insert(s.userRoles).values({ userId: admin!.id, roleCode: "ADMIN" });
  const instructor = await createInstructorFixture(db);
  const [format] = await db
    .insert(s.courseTypes)
    .values({ name: `Attendance ${crypto.randomUUID()}` })
    .returning();
  const [revision] = await db
    .insert(s.courseTypeRevisions)
    .values({
      courseTypeId: format!.id,
      revisionNumber: 1,
      totalHours: 20,
      sessionMinutes: 90,
      studentAmount: "80.00",
      externalAmount: "100.00",
    })
    .returning();
  const [course] = await db
    .insert(s.courses)
    .values({
      name: "Synthetic Attendance Course",
      slug: `attendance-${crypto.randomUUID()}`,
      description: "Only tests",
      level: "BASIC",
      courseTypeRevisionId: revision!.id,
      instructorId: instructor.id,
      schedule: "Lunes a viernes",
      weekdaysMask: 31,
      conditions: "Only tests",
      startsAt: new Date("2099-03-02T04:00:00Z"),
      endsAt: new Date("2099-03-18T23:59:00-04:00"),
      minimumGrade: 50,
      status: "PUBLISHED",
      updatedAt: now,
    })
    .returning();
  const group = options.hook
    ? await new DrizzleGroupRepository(db, () => now).create(
        course!.id,
        "08:00",
        20,
        admin!.id,
      )
    : (
        await db
          .insert(s.groups)
          .values({
            courseId: course!.id,
            courseTypeRevisionId: revision!.id,
            capacity: 20,
            startsAt: new Date("2099-03-02T12:00:00Z"),
            endsAt: new Date("2099-03-18T13:30:00Z"),
            publishedAt: now,
          })
          .returning()
      )[0]!;
  return { admin: admin!, instructor, course: course!, group };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function enroll(f: Fixture, full = true) {
  const config = await finance.settings(f.admin.id);
  return finance.create(
    {
      requestKey: crypto.randomUUID(),
      courseId: f.course.id,
      groupId: f.group.id,
      courseRevision: f.course.updatedAt.toISOString(),
      settingsRevision: config.revision,
      firstDayException: false,
      sourceInterestId: null,
      participantType: "STUDENT",
      participant: {
        ci: `ATT-${crypto.randomUUID()}`,
        firstName: "Synthetic",
        lastName: "Attendance Participant",
        email: "attendee@test.invalid",
        phone: null,
      },
      initialPayment: {
        amountCents: full ? 8000 : 2000,
        effectiveDate: null,
        reason: "Synthetic cash",
      },
    },
    f.admin.id,
  );
}
const command = (f: Fixture, session: { id: string; revision: number }) => ({
  requestKey: crypto.randomUUID(),
  courseId: f.course.id,
  groupId: f.group.id,
  sessionId: session.id,
  revision: session.revision,
});

test("attendance calendar is generated atomically on group creation and idempotently for old groups", async () => {
  const f = await fixture({ hook: true });
  expect(
    await db
      .select()
      .from(s.groupSessions)
      .where(eq(s.groupSessions.groupId, f.group.id)),
  ).toHaveLength(13);
  const group = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  const again = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  expect(group.sessions.map((r) => r.id)).toEqual(
    again.sessions.map((r) => r.id),
  );
  expect(group.sessions.every((r) => !r.administrativeReviewRequired)).toBe(
    true,
  );
  expect(group.operationalEndsAt).toBe(f.group.endsAt.toISOString());
});
test("attendance historical calendars stay pending until explicit administrative roster review", async () => {
  const f = await fixture();
  const registration = await enroll(f);
  now = new Date("2099-03-05T12:00:00Z");
  const group = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  const first = group.sessions[0]!;
  expect(first.administrativeReviewRequired).toBe(true);
  const detail = await repo.getSession(
    f.admin.id,
    f.course.id,
    f.group.id,
    first.id,
  );
  expect(detail.participants).toHaveLength(0);
  expect(detail.reviewCandidates.map((r) => r.registrationId)).toContain(
    registration.id,
  );
  expect(first.instructorAttendance).toMatchObject({
    status: "PENDING",
    markedBy: null,
    inferred: false,
  });
  await repo.record(f.admin.id, {
    ...command(f, first),
    reviewRegistrationIds: [registration.id],
    completeAdministrativeReview: true,
    marks: [{ registrationId: registration.id, status: "EXCUSED" }],
  });
  const reviewed = await repo.getSession(
    f.admin.id,
    f.course.id,
    f.group.id,
    first.id,
  );
  expect(reviewed.participants[0]!.attendance).toMatchObject({
    status: "EXCUSED",
    markedBy: f.admin.id,
    inferred: false,
  });
  expect(reviewed.session.administrativeReviewRequired).toBe(false);
});
test("attendance inferred absence has no fake mark actor or audit and finances remain unchanged", async () => {
  const f = await fixture();
  const registration = await enroll(f);
  const group = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  const first = group.sessions[0]!;
  const before = await finance.detail(registration.id, f.admin.id);
  now = new Date("2099-03-03T04:00:00Z");
  const detail = await repo.getSession(
    f.admin.id,
    f.course.id,
    f.group.id,
    first.id,
  );
  expect(detail.participants[0]!.attendance).toEqual({
    status: "ABSENT",
    inferred: true,
    markedBy: null,
    markedByName: null,
    markedAt: null,
  });
  expect(
    await db
      .select()
      .from(s.participantAttendance)
      .where(eq(s.participantAttendance.sessionId, first.id)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.entityId, first.id),
          eq(s.auditEvents.action, "PARTICIPANT_ATTENDANCE_RECORDED"),
        ),
      ),
  ).toHaveLength(0);
  const after = await finance.detail(registration.id, f.admin.id);
  expect(after).toEqual({
    ...before!,
    registration: { ...before!.registration, membershipStatus: "INSCRITO" },
  });
  expect(Object.keys(detail.participants[0]!)).not.toContain("ci");
  expect(JSON.stringify(detail)).not.toContain("attendee@test.invalid");
});
test("attendance ownership, same civil day, fresh status and enrollment checked on every command", async () => {
  const f = await fixture();
  const paid = await enroll(f);
  const unpaid = await enroll(f, false);
  const group = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  const first = group.sessions[0]!;
  now = new Date("2099-03-02T10:00:00Z");
  const other = await createInstructorFixture(db);
  await expect(
    repo.getGroup(other.id, f.course.id, f.group.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    repo.record(f.instructor.id, {
      ...command(f, first),
      marks: [{ registrationId: unpaid.id, status: "PRESENT" }],
    }),
  ).rejects.toMatchObject({ code: "NOT_ENROLLED" });
  await repo.record(f.instructor.id, {
    ...command(f, first),
    marks: [{ registrationId: paid.id, status: "PRESENT" }],
  });
  now = new Date("2099-03-03T04:00:00Z");
  await expect(
    repo.record(f.instructor.id, {
      ...command(f, { ...first, revision: 2 }),
      marks: [],
    }),
  ).rejects.toMatchObject({ code: "OUTSIDE_ATTENDANCE_DAY" });
  await db
    .update(s.users)
    .set({ status: "DISABLED" })
    .where(eq(s.users.id, f.instructor.id));
  await expect(
    repo.getGroup(f.instructor.id, f.course.id, f.group.id),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
test("attendance recording retries are idempotent, stale batches conflict and admin corrections audit real actor", async () => {
  const f = await fixture();
  const registration = await enroll(f);
  const group = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  const first = group.sessions[0]!;
  now = new Date("2099-03-02T12:00:00Z");
  const input = {
    ...command(f, first),
    marks: [{ registrationId: registration.id, status: "ABSENT" as const }],
  };
  const result = await repo.record(f.instructor.id, input);
  expect(await repo.record(f.instructor.id, input)).toEqual(result);
  await expect(
    repo.record(f.instructor.id, {
      ...input,
      marks: [{ registrationId: registration.id, status: "PRESENT" }],
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const racing = await Promise.allSettled([
    repo.record(f.admin.id, {
      ...command(f, { ...first, revision: 2 }),
      marks: [{ registrationId: registration.id, status: "EXCUSED" }],
    }),
    repo.record(f.admin.id, {
      ...command(f, { ...first, revision: 2 }),
      marks: [{ registrationId: registration.id, status: "PRESENT" }],
    }),
  ]);
  expect(racing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(racing.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "CONCURRENT_UPDATE" },
  });
  now = new Date("2099-03-03T12:00:00Z");
  await repo.record(f.admin.id, {
    ...command(f, { ...first, revision: 3 }),
    marks: [{ registrationId: registration.id, status: "EXCUSED" }],
    instructorStatus: "PRESENT",
  });
  const audit = await db
    .select()
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.entityId, first.id),
        eq(s.auditEvents.action, "PARTICIPANT_ATTENDANCE_RECORDED"),
      ),
    );
  expect(audit).toHaveLength(3);
  expect(
    audit.some(
      (a) =>
        a.actorId === f.admin.id &&
        a.metadata.administrativeCorrection === true,
    ),
  ).toBe(true);
});
test("attendance late settlement with backdated effectiveDate does not rewrite historical membership", async () => {
  const f = await fixture();
  const registration = await enroll(f, false);
  const group = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  now = new Date("2099-03-04T12:00:00Z");
  // Immutable synthetic ledger evidence, not an ordinary payment after the financial cutoff.
  const [receipt] = await db
    .insert(s.registrationCommandReceipts)
    .values({
      actorId: f.admin.id,
      requestKey: crypto.randomUUID(),
      operation: "PAYMENT",
      fingerprint: "a".repeat(64),
      result: registration,
      recordedAt: now,
    })
    .returning();
  await db.insert(s.registrationLedger).values({
    registrationId: registration.id,
    commandReceiptId: receipt!.id,
    kind: "PAYMENT",
    amountCents: "6000",
    effectiveDate: "2099-03-02",
    actorId: f.admin.id,
    reason: "Synthetic immutable late settlement evidence",
    recordedAt: now,
  });
  expect(
    (
      await repo.getSession(
        f.admin.id,
        f.course.id,
        f.group.id,
        group.sessions[0]!.id,
      )
    ).participants,
  ).toHaveLength(0);
  expect(
    (
      await repo.getSession(
        f.admin.id,
        f.course.id,
        f.group.id,
        group.sessions[2]!.id,
      )
    ).participants,
  ).toHaveLength(1);
});
test("attendance replacement conflicts rollback cancellation, supports weekends/extensions and retains all chronology", async () => {
  const f = await fixture();
  const group = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  const first = group.sessions[0]!,
    second = group.sessions[1]!;
  await expect(
    repo.replace(f.admin.id, {
      ...command(f, first),
      startsAt: "2099-03-03T08:00",
    }),
  ).rejects.toMatchObject({ code: "SCHEDULE_CONFLICT" });
  expect(
    (await repo.getGroup(f.admin.id, f.course.id, f.group.id)).sessions[0]!
      .status,
  ).not.toBe("CANCELLED");
  const replacement = await repo.replace(f.admin.id, {
    ...command(f, first),
    startsAt: "2099-03-21T06:00",
    reason: "Synthetic holiday",
  });
  expect(replacement.kind).toBe("session");
  const calendar = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  expect(calendar.sessions).toHaveLength(14);
  expect(calendar.sessions.find((r) => r.id === first.id)!.status).toBe(
    "CANCELLED",
  );
  expect(calendar.operationalEndsAt).toBe("2099-03-21T11:30:00.000Z");
  expect(calendar.officialEndsAt).toBe(f.course.endsAt.toISOString());
  await expect(
    repo.replace(f.admin.id, {
      ...command(f, { ...first, revision: 2 }),
      startsAt: "2099-03-22T06:00",
    }),
  ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
  expect(second.revision).toBe(1);
});
test("attendance lifecycle allows same-day future changes but rejects started, past targets and either attendance mark", async () => {
  const f = await fixture();
  const registration = await enroll(f);
  const group = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  const first = group.sessions[0]!;
  now = new Date("2099-03-02T11:00:00Z");
  await expect(
    repo.replace(f.admin.id, {
      ...command(f, first),
      startsAt: "2099-03-02T07:00",
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(
    repo.replace(f.admin.id, {
      ...command(f, first),
      startsAt: "2099-03-01T08:00",
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const result = await repo.replace(f.admin.id, {
    ...command(f, first),
    startsAt: "2099-03-02T07:30",
  });
  if (result.kind !== "session") throw new Error("Expected replacement");
  const calendar = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  const recovery = calendar.sessions.find((r) => r.id === result.sessionId)!;
  expect(
    new Date(recovery.endsAt).getTime() - new Date(recovery.startsAt).getTime(),
  ).toBe(5400000);
  expect(recovery).toMatchObject({ canCancel: true, canReplace: true });
  now = new Date(recovery.startsAt);
  await expect(
    repo.cancel(f.admin.id, command(f, recovery)),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(
    repo.replace(f.admin.id, {
      ...command(f, recovery),
      startsAt: "2099-03-21T08:00",
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  now = new Date("2099-03-03T11:00:00Z");
  const second = group.sessions[1]!;
  await repo.record(f.instructor.id, {
    ...command(f, second),
    marks: [{ registrationId: registration.id, status: "EXCUSED" }],
  });
  await expect(
    repo.cancel(f.admin.id, command(f, { ...second, revision: 2 })),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(
    repo.replace(f.admin.id, {
      ...command(f, { ...second, revision: 2 }),
      startsAt: "2099-03-21T08:00",
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  now = new Date("2099-03-04T11:00:00Z");
  const third = group.sessions[2]!;
  await repo.record(f.admin.id, {
    ...command(f, third),
    marks: [],
    instructorStatus: "ABSENT",
  });
  const marked = (
    await repo.getGroup(f.admin.id, f.course.id, f.group.id)
  ).sessions.find((r) => r.id === third.id)!;
  expect(marked).toMatchObject({ canCancel: false, canReplace: false });
  for (const operation of ["cancel", "replace"] as const) {
    const siteUrl = new URL("https://test.invalid");
    const response = await handleAttendancePost({
      request: new Request(siteUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: siteUrl.origin },
        body: JSON.stringify({
          requestKey: crypto.randomUUID(),
          revision: marked.revision,
          ...(operation === "replace" ? { startsAt: "2099-03-21T08:00" } : {}),
        }),
      }),
      actor: { ...f.admin, roles: ["ADMIN"] },
      repository: repo,
      siteUrl,
      operation,
      courseId: f.course.id,
      groupId: f.group.id,
      sessionId: marked.id,
    });
    expect(response).toMatchObject({
      status: 422,
      payload: { ok: false, code: "VALIDATION_FAILED" },
    });
  }
  now = new Date("2099-03-05T12:00:00Z");
  await repo.record(f.admin.id, {
    ...command(f, marked),
    marks: [],
    instructorStatus: "PRESENT",
  });
  expect(
    (await repo.getSession(f.admin.id, f.course.id, f.group.id, third.id))
      .session.instructorAttendance.status,
  ).toBe("PRESENT");
  const fourth = group.sessions[3]!;
  let samples = 0;
  const crossingRepo = new DrizzleAttendanceRepository(
    db,
    () =>
      new Date(new Date(fourth.startsAt).getTime() - (samples++ === 0 ? 1 : 0)),
  );
  await expect(
    crossingRepo.cancel(f.admin.id, command(f, fourth)),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  now = new Date(new Date(fourth.startsAt).getTime() - 1);
  await repo.cancel(f.admin.id, command(f, fourth));
  expect(
    (await repo.getGroup(f.admin.id, f.course.id, f.group.id)).sessions.find(
      (r) => r.id === fourth.id,
    )!.status,
  ).toBe("CANCELLED");
  await db
    .update(s.users)
    .set({ status: "DISABLED" })
    .where(eq(s.users.id, f.admin.id));
  await expect(
    repo.cancel(f.admin.id, command(f, group.sessions[4]!)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    repo.replace(f.admin.id, {
      ...command(f, group.sessions[4]!),
      startsAt: "2099-03-21T08:00",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
test("attendance settings are independent, positive, optimistic and auditable without financial lost updates", async () => {
  const f = await fixture();
  const financial = await finance.settings(f.admin.id);
  const config = await repo.getSettings(f.admin.id);
  expect(config.consecutiveAbsenceLimit).toBe(3);
  const input = {
    requestKey: crypto.randomUUID(),
    revision: config.revision,
    consecutiveAbsenceLimit: 5,
  };
  const result = await repo.updateSettings(f.admin.id, input);
  expect(await repo.updateSettings(f.admin.id, input)).toEqual(result);
  expect(await finance.settings(f.admin.id)).toEqual(financial);
  await expect(
    repo.updateSettings(f.admin.id, {
      ...input,
      requestKey: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
  await expect(
    repo.updateSettings(f.instructor.id, {
      ...input,
      requestKey: crypto.randomUUID(),
      revision: 2,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("attendance cross-course instructor conflicts and cancelled recovery chains preserve one active encounter", async () => {
  const f = await fixture();
  const firstGroup = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  const first = firstGroup.sessions[0]!;
  const [otherCourse] = await db
    .insert(s.courses)
    .values({
      ...f.course,
      id: crypto.randomUUID(),
      slug: `attendance-shared-${crypto.randomUUID()}`,
    })
    .returning();
  const [otherGroup] = await db
    .insert(s.groups)
    .values({
      ...f.group,
      id: crypto.randomUUID(),
      courseId: otherCourse!.id,
      startsAt: new Date("2099-03-02T14:00:00Z"),
      endsAt: new Date("2099-03-18T15:30:00Z"),
    })
    .returning();
  await repo.getGroup(f.admin.id, otherCourse!.id, otherGroup!.id);
  await expect(
    repo.replace(f.admin.id, {
      ...command(f, first),
      startsAt: "2099-03-02T10:00",
    }),
  ).rejects.toMatchObject({ code: "SCHEDULE_CONFLICT" });
  const replaced = await repo.replace(f.admin.id, {
    ...command(f, first),
    startsAt: "2099-03-21T08:00",
  });
  if (replaced.kind !== "session") throw new Error("Expected replacement");
  const replacedAgain = await repo.replace(f.admin.id, {
    ...command(f, { id: replaced.sessionId, revision: 1 }),
    startsAt: "2099-03-22T08:00",
  });
  expect(replacedAgain.kind).toBe("session");
  await expect(
    repo.replace(f.admin.id, {
      ...command(f, { ...first, revision: 2 }),
      startsAt: "2099-03-23T08:00",
    }),
  ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
  const calendar = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  expect(
    calendar.sessions.filter((row) => row.status !== "CANCELLED"),
  ).toHaveLength(13);
  expect(calendar.sessions).toHaveLength(15);
  if (replacedAgain.kind !== "session") throw new Error("Expected replacement");
  await repo.cancel(
    f.admin.id,
    command(f, { id: replacedAgain.sessionId, revision: 1 }),
  );
  const attempts = await Promise.allSettled([
    repo.replace(f.admin.id, {
      ...command(f, { ...first, revision: 2 }),
      startsAt: "2099-03-21T08:00",
    }),
    repo.replace(f.admin.id, {
      ...command(f, { id: replacedAgain.sessionId, revision: 2 }),
      startsAt: "2099-03-22T08:00",
    }),
  ]);
  expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(attempts.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "CONCURRENT_UPDATE" },
  });
  // Both cancelled recovery intervals are released; a different encounter can reserve the unused one.
  const won = attempts[0]!.status === "fulfilled";
  await repo.replace(f.admin.id, {
    ...command(f, firstGroup.sessions[1]!),
    startsAt: won ? "2099-03-22T08:00" : "2099-03-21T08:00",
  });
  const finalCalendar = await repo.getGroup(
    f.admin.id,
    f.course.id,
    f.group.id,
  );
  expect(
    finalCalendar.sessions.filter((row) => row.status !== "CANCELLED"),
  ).toHaveLength(13);
  expect(
    finalCalendar.sessions.find((row) => row.id === replacedAgain.sessionId)!
      .status,
  ).toBe("CANCELLED");
});

test("attendance pre-start group schedule changes preserve original timestamps as linked replacements", async () => {
  const f = await fixture({ hook: true });
  const original = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  const changed = await new DrizzleGroupRepository(
    db,
    () => now,
  ).changeSchedule(f.group.id, "09:00", f.admin.id, f.group.updatedAt);
  const calendar = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  expect(changed.startsAt.toISOString()).toBe("2099-03-02T13:00:00.000Z");
  expect(calendar.sessions).toHaveLength(26);
  expect(
    calendar.sessions.filter((row) => row.status !== "CANCELLED"),
  ).toHaveLength(13);
  for (const row of original.sessions)
    expect(calendar.sessions.find((r) => r.id === row.id)).toMatchObject({
      startsAt: row.startsAt,
      status: "CANCELLED",
    });
});

test("attendance group cancellation retains past evidence and cancels only remaining operative sessions", async () => {
  const f = await fixture();
  const registration = await enroll(f);
  const calendar = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  const first = calendar.sessions[0]!;
  await db.insert(s.groups).values({
    ...f.group,
    id: crypto.randomUUID(),
    startsAt: new Date("2099-03-02T14:00:00Z"),
    endsAt: new Date("2099-03-18T15:30:00Z"),
  });
  now = new Date("2099-03-02T12:00:00Z");
  await repo.record(f.instructor.id, {
    ...command(f, first),
    marks: [{ registrationId: registration.id, status: "PRESENT" }],
  });
  now = new Date("2099-03-03T04:00:00Z");
  await new DrizzleGroupRepository(db, () => now).cancel(
    f.group.id,
    f.admin.id,
    f.group.updatedAt,
  );
  const after = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  expect(after.sessions.find((row) => row.id === first.id)!.status).toBe(
    "COMPLETED",
  );
  expect(
    after.sessions.filter((row) => row.status === "CANCELLED"),
  ).toHaveLength(12);
  expect(
    (
      await repo.getGroup(f.instructor.id, f.course.id, f.group.id)
    ).sessions.every((row) => !row.canRecord),
  ).toBe(true);
  const detail = await repo.getSession(
    f.admin.id,
    f.course.id,
    f.group.id,
    first.id,
  );
  expect(detail.participants[0]!.attendance.status).toBe("PRESENT");
  await repo.record(f.admin.id, {
    ...command(f, { ...first, revision: 2 }),
    marks: [{ registrationId: registration.id, status: "EXCUSED" }],
  });
  expect(
    (await repo.getSession(f.admin.id, f.course.id, f.group.id, first.id))
      .participants[0]!.attendance.status,
  ).toBe("EXCUSED");
});
test("attendance DB constraints protect duration, chronology, source group, RLS and private grants", async () => {
  const f = await fixture();
  const group = await repo.getGroup(f.admin.id, f.course.id, f.group.id);
  const first = group.sessions[0]!;
  await expect(
    db
      .update(s.groupSessions)
      .set({ startsAt: new Date("2099-03-02T11:00:00Z") })
      .where(eq(s.groupSessions.id, first.id))
      .execute(),
  ).rejects.toThrow();
  await expect(
    db
      .insert(s.groupSessions)
      .values({
        groupId: f.group.id,
        courseTypeRevisionId: f.course.courseTypeRevisionId,
        ordinal: 100,
        startsAt: new Date("2099-03-20T12:00:00Z"),
        endsAt: new Date("2099-03-20T12:30:00Z"),
      })
      .execute(),
  ).rejects.toThrow();
  const rows = await db.execute(
    sql`select relname, relrowsecurity, has_table_privilege('anon',oid,'SELECT') as anon_read, has_table_privilege('authenticated',oid,'INSERT') as client_write from pg_class where relnamespace = 'public'::regnamespace and relname in ('group_sessions','session_roster','participant_attendance','instructor_attendance','attendance_settings','attendance_command_receipts')`,
  );
  expect(rows).toHaveLength(6);
  expect(
    rows.every(
      (r) =>
        r.relrowsecurity === true &&
        r.anon_read === false &&
        r.client_write === false,
    ),
  ).toBe(true);
});
