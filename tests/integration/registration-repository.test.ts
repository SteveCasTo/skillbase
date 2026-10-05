import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";
import { DrizzleInterestRepository } from "@/server/db/repositories/interest-repository";
import { DrizzleGroupRepository } from "@/server/db/repositories/group-repository";
import { DrizzleCourseRepository } from "@/server/db/repositories/course-repository";
import * as schema from "@/server/db/schema";
import type { CreateRegistrationInput } from "@/domain/pre-registrations/types";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createInstructorFixture } from "../fixtures/instructors";

const database = createDatabase(getTestSupabaseEnvironment().databaseUrl, {
  max: 8,
});
const db = database.db;
let now = new Date("2099-02-01T12:00:00.000Z");
const repository = createRegistrationRepository(db, () => now);
async function restoreSettingsDefaults() {
  // db is created only after the runner-owned isolated stack guard above succeeds.
  await db.update(schema.registrationSettings).set({
    revision: 1,
    minimumPaymentPercent: 25,
    auxiliaryDiscountPercent: 50,
    updatedBy: null,
  });
}
beforeEach(restoreSettingsDefaults);
afterEach(restoreSettingsDefaults);
afterAll(async () => {
  // Only this isolated test suite's synthetic financial tables; never bypass append-only triggers.
  await db.execute(
    sql`truncate participant_attendance, instructor_attendance, session_roster, attendance_command_receipts, group_sessions, registration_ledger, registration_command_receipts, pre_registrations, participants restrict`,
  );
  await restoreSettingsDefaults();
  await database.close();
});
async function fixture(capacity = 3) {
  now = new Date("2099-02-01T12:00:00.000Z");
  const [actor] = await db
    .insert(schema.users)
    .values({
      email: `registration-${crypto.randomUUID()}@test.invalid`,
      name: "Synthetic Admin",
      authUserId: crypto.randomUUID(),
      status: "ACTIVE",
    })
    .returning();
  await db
    .insert(schema.userRoles)
    .values({ userId: actor!.id, roleCode: "ADMIN" });
  const instructor = await createInstructorFixture(db);
  const [format] = await db
    .insert(schema.courseTypes)
    .values({ name: `Registration ${crypto.randomUUID()}` })
    .returning();
  const [revision] = await db
    .insert(schema.courseTypeRevisions)
    .values({
      courseTypeId: format!.id,
      revisionNumber: 1,
      totalHours: 20,
      sessionMinutes: 90,
      studentAmount: "80.01",
      externalAmount: "100.00",
    })
    .returning();
  const [course] = await db
    .insert(schema.courses)
    .values({
      name: "Synthetic Course",
      slug: `registration-${crypto.randomUUID()}`,
      description: "Only tests",
      level: "BASIC",
      courseTypeRevisionId: revision!.id,
      instructorId: instructor.id,
      schedule: "Lunes a viernes",
      weekdaysMask: 31,
      conditions: "Only tests",
      startsAt: new Date("2099-03-02T04:00:00.000Z"),
      endsAt: new Date("2099-03-20T04:00:00.000Z"),
      minimumGrade: 50,
      status: "PUBLISHED",
      updatedAt: now,
    })
    .returning();
  const groups = await db
    .insert(schema.groups)
    .values(
      [8, 10].map((hour) => ({
        courseId: course!.id,
        courseTypeRevisionId: revision!.id,
        capacity,
        startsAt: new Date(`2099-03-02T${hour + 4}:00:00Z`),
        endsAt: new Date(`2099-03-20T${hour + 5}:30:00Z`),
        publishedAt: now,
        updatedAt: now,
      })),
    )
    .returning();
  const settings = await repository.settings(actor!.id);
  const input: CreateRegistrationInput = {
    requestKey: crypto.randomUUID(),
    courseId: course!.id,
    groupId: groups[0]!.id,
    courseRevision: course!.updatedAt.toISOString(),
    settingsRevision: settings.revision,
    firstDayException: false,
    sourceInterestId: null,
    participantType: "STUDENT",
    participant: {
      ci: `00AB-${crypto.randomUUID()}`,
      firstName: "Synthetic",
      lastName: "Participant",
      email: "participant@test.invalid",
      phone: null,
    },
    initialPayment: {
      amountCents: 2001,
      effectiveDate: null,
      reason: "Initial cash",
    },
  };
  return { actor: actor!, instructor, course: course!, groups, input };
}
const mutation = (row: { id: string; revision: string }) => ({
  requestKey: crypto.randomUUID(),
  registrationId: row.id,
  revision: row.revision,
});

test("registration last-seat race serializes two actors and rolls back losing identity/audit/receipt", async () => {
  const f = await fixture(1);
  const other = await fixture();
  const results = await Promise.allSettled([
    repository.create(f.input, f.actor.id),
    repository.create(
      {
        ...f.input,
        requestKey: crypto.randomUUID(),
        participant: { ...f.input.participant, ci: crypto.randomUUID() },
      },
      other.actor.id,
    ),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected).toMatchObject({ reason: { code: "CAPACITY_EXCEEDED" } });
  const form = await repository.form(f.course.id, f.actor.id);
  expect(
    form!.groups.find((group) => group.id === f.input.groupId)!.occupied,
  ).toBe(1);
  expect(
    (
      await repository.list(
        { courseId: f.course.id, page: 1, pageSize: 20 },
        f.actor.id,
      )
    ).total,
  ).toBe(1);
});
test("CI is global across courses; duplicate course races and profile conflicts do not merge by email", async () => {
  const f = await fixture();
  const other = await fixture();
  const results = await Promise.allSettled([
    repository.create(f.input, f.actor.id),
    repository.create(
      { ...f.input, requestKey: crypto.randomUUID() },
      other.actor.id,
    ),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "ACTIVE_REGISTRATION_EXISTS" },
  });
  const first = results.find((result) => result.status === "fulfilled");
  if (first?.status !== "fulfilled") throw new Error("No registration");
  const second = await repository.create(
    {
      ...other.input,
      participant: {
        ...f.input.participant,
        ci: ` ${f.input.participant.ci.toLowerCase()} `,
      },
    },
    other.actor.id,
  );
  expect(second.participant.id).toBe(first.value.participant.id);
  await expect(
    repository.create(
      {
        ...other.input,
        requestKey: crypto.randomUUID(),
        participant: { ...f.input.participant, firstName: "Changed" },
        courseId: f.course.id,
      },
      other.actor.id,
    ),
  ).rejects.toMatchObject({ code: "GROUP_COURSE_MISMATCH" });
  const third = await fixture();
  await expect(
    repository.create(
      {
        ...third.input,
        participant: { ...f.input.participant, firstName: "Changed" },
      },
      third.actor.id,
    ),
  ).rejects.toMatchObject({ code: "PARTICIPANT_DETAILS_CONFLICT" });
});
test("create idempotency returns original DTO; changed payload or operation rejects without extra cash", async () => {
  const f = await fixture();
  const [first, repeat] = await Promise.all([
    repository.create(f.input, f.actor.id),
    repository.create(f.input, f.actor.id),
  ]);
  expect(repeat).toEqual(first);
  expect(first.registeredByName).toBeTruthy();
  expect((await repository.detail(first.id, f.actor.id))!.ledger).toHaveLength(
    1,
  );
  const before = await db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.entityId, first.id));
  await expect(
    repository.create(
      {
        ...f.input,
        initialPayment: { ...f.input.initialPayment!, amountCents: 2002 },
      },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    repository.recordPayment(
      {
        ...mutation(first),
        requestKey: f.input.requestKey,
        cash: { amountCents: 1, effectiveDate: null, reason: "Cash" },
      },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(
    await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, first.id)),
  ).toHaveLength(before.length);
});
test("payment races enforce optimistic revisions and balance; retries post only one immutable ledger row", async () => {
  const f = await fixture();
  const row = await repository.create(f.input, f.actor.id);
  const command = {
    ...mutation(row),
    cash: { amountCents: 6000, effectiveDate: null, reason: "Balance" },
  };
  const [a, b] = await Promise.all([
    repository.recordPayment(command, f.actor.id),
    repository.recordPayment(command, f.actor.id),
  ]);
  expect(a).toEqual(b);
  expect(a.registration.balanceCents).toBe(0);
  expect(a.ledger).toHaveLength(2);
  await expect(
    repository.recordPayment(
      {
        ...mutation(a.registration),
        cash: { ...command.cash, amountCents: 1 },
      },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE" });
  const g = await fixture();
  const partial = await repository.create(g.input, g.actor.id);
  const race = await Promise.allSettled(
    [1, 2].map(() =>
      repository.recordPayment(
        {
          ...mutation(partial),
          cash: {
            amountCents: 4000,
            effectiveDate: null,
            reason: "Racing cash",
          },
        },
        g.actor.id,
      ),
    ),
  );
  expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(
    1,
  );
  expect(race.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "CONCURRENT_UPDATE" },
  });
  expect(
    (await repository.detail(partial.id, g.actor.id))!.registration.paidCents,
  ).toBe(6001);
});
test("cancel releases seat and preserves liability; refund races cannot exceed paid or invent money", async () => {
  const f = await fixture(1);
  const row = await repository.create(f.input, f.actor.id);
  const cancelled = await repository.cancel(
    { ...mutation(row), reason: "Personal cancellation", refundedNow: null },
    f.actor.id,
  );
  expect(cancelled.registration).toMatchObject({
    state: "CANCELLED",
    refundDueCents: 2001,
    financialStatus: "REFUND_DUE",
  });
  expect(cancelled.ledger).toHaveLength(1);
  const race = await Promise.allSettled(
    [1, 2].map(() =>
      repository.recordRefund(
        {
          ...mutation(cancelled.registration),
          cash: {
            amountCents: 1500,
            effectiveDate: null,
            reason: "Actual cash returned",
          },
        },
        f.actor.id,
      ),
    ),
  );
  expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(
    1,
  );
  const detail = (await repository.detail(row.id, f.actor.id))!;
  expect(detail.registration.refundDueCents).toBe(501);
  await expect(
    repository.recordRefund(
      {
        ...mutation(detail.registration),
        cash: { amountCents: 502, effectiveDate: null, reason: "Too much" },
      },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "REFUND_EXCEEDS_DUE" });
  const settled = await repository.recordRefund(
    {
      ...mutation(detail.registration),
      cash: {
        amountCents: 501,
        effectiveDate: null,
        reason: "Remaining cash returned",
      },
    },
    f.actor.id,
  );
  expect(settled.registration.financialStatus).toBe("REFUNDED");
  const replacement = await repository.create(
    { ...f.input, requestKey: crypto.randomUUID() },
    f.actor.id,
  );
  expect(replacement.id).not.toBe(row.id);
});
test("group cancellation after cutoff creates full liability without fake refunds and races create/transfer safely", async () => {
  const f = await fixture(2);
  const row = await repository.create(f.input, f.actor.id);
  const groups = new DrizzleGroupRepository(db, () => now);
  const race = await Promise.allSettled([
    groups.cancel(f.groups[0]!.id, f.actor.id, f.groups[0]!.updatedAt),
    repository.create(
      {
        ...f.input,
        requestKey: crypto.randomUUID(),
        participant: { ...f.input.participant, ci: crypto.randomUUID() },
      },
      f.actor.id,
    ),
  ]);
  expect(race[0]!.status).toBe("fulfilled");
  const detail = (await repository.detail(row.id, f.actor.id))!;
  expect(detail.registration).toMatchObject({
    state: "CANCELLED",
    cancellationReason: "GROUP_CANCELLED",
    refundDueCents: 2001,
  });
  expect(detail.ledger.map((entry) => entry.kind)).toEqual(["PAYMENT"]);
  expect(
    (await repository.form(f.course.id, f.actor.id))!.groups.find(
      (group) => group.id === f.groups[0]!.id,
    )!.occupied,
  ).toBe(0);
  now = new Date("2099-03-05T12:00:00Z");
  const g = await fixture();
  const paid = await repository.create(g.input, g.actor.id);
  now = new Date("2099-03-05T12:00:00Z");
  await expect(
    repository.cancel(
      { ...mutation(paid), reason: "Late", refundedNow: null },
      g.actor.id,
    ),
  ).rejects.toMatchObject({ code: "CANCELLATION_CLOSED" });
  await groups.cancel(g.groups[0]!.id, g.actor.id, g.groups[0]!.updatedAt);
  expect(
    (await repository.detail(paid.id, g.actor.id))!.registration.refundDueCents,
  ).toBe(2001);
});
test("capacity edits cannot reduce below occupied; transfers preserve snapshot and enforce course and seats", async () => {
  const f = await fixture(2);
  const row = await repository.create(f.input, f.actor.id);
  await repository.create(
    {
      ...f.input,
      requestKey: crypto.randomUUID(),
      participant: { ...f.input.participant, ci: crypto.randomUUID() },
    },
    f.actor.id,
  );
  const groups = new DrizzleGroupRepository(db);
  await expect(
    groups.changeCapacity(
      f.groups[0]!.id,
      1,
      f.actor.id,
      f.groups[0]!.updatedAt,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const moved = await repository.transfer(
    { ...mutation(row), destinationGroupId: f.groups[1]!.id },
    f.actor.id,
  );
  expect(moved.price).toEqual(row.price);
  const other = await fixture();
  await expect(
    repository.transfer(
      { ...mutation(moved), destinationGroupId: other.groups[0]!.id },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "GROUP_COURSE_MISMATCH" });
});
test("settings optimistic updates do not alter historical snapshots; auxiliary ceil and free zero ledger", async () => {
  const f = await fixture();
  const row = await repository.create(
    {
      ...f.input,
      participantType: "AUXILIARY",
      initialPayment: { ...f.input.initialPayment!, amountCents: 1001 },
    },
    f.actor.id,
  );
  expect(row.price).toMatchObject({
    totalPriceCents: 4001,
    minimumPaymentCents: 1001,
  });
  const current = await repository.settings(f.actor.id);
  const change = {
    requestKey: crypto.randomUUID(),
    revision: current.revision,
    minimumPaymentPercent: 100,
    auxiliaryDiscountPercent: 100,
  };
  const updated = await repository.updateSettings(change, f.actor.id);
  expect(await repository.updateSettings(change, f.actor.id)).toEqual(updated);
  await expect(
    repository.updateSettings(
      { ...change, requestKey: crypto.randomUUID() },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
  expect(
    (await repository.detail(row.id, f.actor.id))!.registration.price,
  ).toEqual(row.price);
  const free = await repository.create(
    {
      ...f.input,
      requestKey: crypto.randomUUID(),
      participant: { ...f.input.participant, ci: crypto.randomUUID() },
      participantType: "AUXILIARY",
      settingsRevision: updated.revision,
      initialPayment: null,
    },
    f.actor.id,
  );
  expect(free.financialStatus).toBe("EXEMPT");
  expect((await repository.detail(free.id, f.actor.id))!.ledger).toHaveLength(
    0,
  );
  await repository.updateSettings(
    {
      requestKey: crypto.randomUUID(),
      revision: updated.revision,
      minimumPaymentPercent: 25,
      auxiliaryDiscountPercent: 50,
    },
    f.actor.id,
  );
});
test("Bolivia first-day full-pay exception and overdue retain seats; backdated cash cannot bypass now", async () => {
  const f = await fixture();
  const row = await repository.create(f.input, f.actor.id);
  now = new Date("2099-03-03T03:59:59.000Z");
  await expect(
    repository.create(
      {
        ...f.input,
        requestKey: crypto.randomUUID(),
        participant: { ...f.input.participant, ci: crypto.randomUUID() },
        firstDayException: true,
      },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "FULL_PAYMENT_REQUIRED" });
  const late = await repository.create(
    {
      ...f.input,
      requestKey: crypto.randomUUID(),
      participant: { ...f.input.participant, ci: crypto.randomUUID() },
      firstDayException: true,
      initialPayment: {
        amountCents: 8001,
        effectiveDate: "2099-02-01",
        reason: "Full cash",
      },
    },
    f.actor.id,
  );
  expect(late.membershipStatus).toBe("INSCRITO");
  now = new Date("2099-03-03T04:00:00.000Z");
  expect(
    (await repository.detail(row.id, f.actor.id))!.registration
      .membershipStatus,
  ).toBe("SALDOVENCIDO");
  await expect(
    repository.recordPayment(
      {
        ...mutation(row),
        cash: {
          amountCents: 6000,
          effectiveDate: "2099-02-01",
          reason: "Backdated",
        },
      },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "PAYMENT_DEADLINE_PASSED" });
  expect(
    (await repository.form(f.course.id, f.actor.id))!.groups[0]!.occupied,
  ).toBe(2);
  expect(
    (
      await repository.list(
        {
          courseId: f.course.id,
          membershipStatus: "SALDOVENCIDO",
          page: 1,
          pageSize: 10,
        },
        f.actor.id,
      )
    ).items.map((item) => item.id),
  ).toEqual([row.id]);
});
test("fresh role/status authorization and instructor ownership/start return names only", async () => {
  const f = await fixture();
  const row = await repository.create(f.input, f.actor.id);
  await expect(
    repository.detail(row.id, f.instructor.id),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    repository.instructorRoster(f.course.id, row.groupId, f.instructor.id),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  now = f.course.startsAt;
  expect(
    await repository.instructorRoster(
      f.course.id,
      row.groupId,
      f.instructor.id,
    ),
  ).toEqual([{ firstName: "Synthetic", lastName: "Participant" }]);
  const other = await createInstructorFixture(db);
  await expect(
    repository.instructorRoster(f.course.id, row.groupId, other.id),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db
    .update(schema.users)
    .set({ status: "DISABLED" })
    .where(eq(schema.users.id, f.actor.id));
  await expect(repository.create(f.input, f.actor.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(repository.settings(f.actor.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
test("participant revisions update globally without changing historical money and searches escape wildcards", async () => {
  const f = await fixture();
  const row = await repository.create(f.input, f.actor.id);
  const command = {
    requestKey: crypto.randomUUID(),
    participantId: row.participant.id,
    revision: row.participant.revision,
    participant: { ...row.participant, firstName: "Revised" },
  };
  const updated = await repository.updateParticipant(command, f.actor.id);
  expect(await repository.updateParticipant(command, f.actor.id)).toEqual(
    updated,
  );
  await expect(
    repository.updateParticipant(
      { ...command, requestKey: crypto.randomUUID() },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
  const detail = (await repository.detail(row.id, f.actor.id))!;
  expect(detail.registration.participant.firstName).toBe("Revised");
  expect(detail.registration.price).toEqual(row.price);
  expect(await repository.findParticipants("%%", f.actor.id, 20)).toEqual([]);
  expect(
    (await repository.findParticipants(updated.ci, f.actor.id, 20)).map(
      (person) => person.id,
    ),
  ).toEqual([updated.id]);
});

test("interest prefill is same-course editable trace only and does not mutate public interest metrics", async () => {
  const f = await fixture();
  const [interest] = await db
    .insert(schema.interestRegistrations)
    .values({
      courseId: f.course.id,
      firstName: "Public",
      lastName: "Origin",
      email: "public@test.invalid",
      preferredGroupId: f.groups[1]!.id,
    })
    .returning();
  const form = await repository.form(f.course.id, f.actor.id, interest!.id);
  expect(form!.sourceInterest!.firstName).toBe("Public");
  const interests = new DrizzleInterestRepository(db);
  expect(
    (await interests.course(f.course.id))!.availableForPrefillInterestIds,
  ).toContain(interest!.id);
  const row = await repository.create(
    {
      ...f.input,
      sourceInterestId: interest!.id,
      initialPayment: { amountCents: 2001, effectiveDate: null },
    },
    f.actor.id,
  );
  expect(row.sourceInterestId).toBe(interest!.id);
  expect(row.participant.firstName).toBe("Synthetic");
  expect(row.paidCents).toBe(2001);
  const ledger = (await repository.detail(row.id, f.actor.id))!.ledger;
  expect(ledger[0]?.reason).toBeNull();
  expect(ledger[0]?.actorName).toBeTruthy();
  expect(row.groupId).not.toBe(interest!.preferredGroupId);
  const availableAfterRegistration = await interests.course(f.course.id);
  expect(
    availableAfterRegistration!.availableForPrefillInterestIds,
  ).not.toContain(interest!.id);
  expect(availableAfterRegistration!.metrics.activeTotal).toBe(1);
  await expect(
    repository.form(f.course.id, f.actor.id, interest!.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    repository.create(
      {
        ...f.input,
        requestKey: crypto.randomUUID(),
        sourceInterestId: interest!.id,
      },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    (
      await db
        .select()
        .from(schema.interestRegistrations)
        .where(eq(schema.interestRegistrations.id, interest!.id))
    )[0],
  ).toEqual(interest!);
  const other = await fixture();
  await expect(
    repository.form(other.course.id, other.actor.id, interest!.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    repository.create(
      { ...other.input, sourceInterestId: interest!.id },
      other.actor.id,
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
test("eligibility rechecks withdrawn course, cancelled group and inactive instructor under transaction locks", async () => {
  const f = await fixture();
  await db
    .update(schema.courses)
    .set({ status: "DRAFT" })
    .where(eq(schema.courses.id, f.course.id));
  await expect(repository.create(f.input, f.actor.id)).rejects.toMatchObject({
    code: "COURSE_UNAVAILABLE",
  });
  await db
    .update(schema.courses)
    .set({ status: "PUBLISHED" })
    .where(eq(schema.courses.id, f.course.id));
  await db
    .update(schema.users)
    .set({ status: "DISABLED" })
    .where(eq(schema.users.id, f.instructor.id));
  await expect(repository.create(f.input, f.actor.id)).rejects.toMatchObject({
    code: "INSTRUCTOR_INACTIVE",
  });
  await db
    .update(schema.users)
    .set({ status: "ACTIVE" })
    .where(eq(schema.users.id, f.instructor.id));
  await db
    .update(schema.groups)
    .set({ status: "CANCELLED" })
    .where(eq(schema.groups.id, f.input.groupId));
  await expect(repository.create(f.input, f.actor.id)).rejects.toMatchObject({
    code: "GROUP_UNAVAILABLE",
  });
  expect(
    (
      await db
        .select()
        .from(schema.registrationCommandReceipts)
        .where(eq(schema.registrationCommandReceipts.actorId, f.actor.id))
    ).length,
  ).toBe(0);
});
test("cash date and exact minimum reject atomically; free snapshots never produce zero cash rows", async () => {
  const f = await fixture();
  await expect(
    repository.create(
      {
        ...f.input,
        initialPayment: { ...f.input.initialPayment!, amountCents: 2000 },
      },
      f.actor.id,
    ),
  ).rejects.toMatchObject({
    code: "MINIMUM_PAYMENT_REQUIRED",
    details: { minimumCents: 2001 },
  });
  await expect(
    repository.create({ ...f.input, initialPayment: null }, f.actor.id),
  ).rejects.toMatchObject({ code: "INITIAL_PAYMENT_REQUIRED" });
  await expect(
    repository.create(
      {
        ...f.input,
        initialPayment: {
          ...f.input.initialPayment!,
          effectiveDate: "2099-02-02",
        },
      },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(
    repository.create(
      {
        ...f.input,
        initialPayment: { ...f.input.initialPayment!, amountCents: 8002 },
      },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE" });
  const row = await repository.create(f.input, f.actor.id);
  const [entry] = (await repository.detail(row.id, f.actor.id))!.ledger;
  expect(entry).toMatchObject({
    actorId: f.actor.id,
    effectiveDate: "2099-02-01",
    recordedAt: now.toISOString(),
    amountCents: 2001,
  });
  const [receipt] = await db
    .select()
    .from(schema.registrationCommandReceipts)
    .where(
      eq(schema.registrationCommandReceipts.requestKey, f.input.requestKey),
    );
  const [ledger] = await db
    .select()
    .from(schema.registrationLedger)
    .where(eq(schema.registrationLedger.registrationId, row.id));
  expect(ledger!.commandReceiptId).toBe(receipt!.id);
  expect(receipt!.actorId).toBe(ledger!.actorId);
  const audits = await db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.entityId, row.id));
  expect(audits).toHaveLength(2);
  expect(
    audits.every(
      (event) =>
        !JSON.stringify(event.metadata).includes("participant@test.invalid"),
    ),
  ).toBe(true);
});
test("transfer into last seat races safely and group cancellation cannot leave active memberships", async () => {
  const f = await fixture(2);
  const one = await repository.create(f.input, f.actor.id);
  const two = await repository.create(
    {
      ...f.input,
      requestKey: crypto.randomUUID(),
      participant: { ...f.input.participant, ci: crypto.randomUUID() },
    },
    f.actor.id,
  );
  const groups = new DrizzleGroupRepository(db, () => now);
  const destination = await groups.changeCapacity(
    f.groups[1]!.id,
    1,
    f.actor.id,
    f.groups[1]!.updatedAt,
  );
  const raced = await Promise.allSettled(
    [one, two].map((row) =>
      repository.transfer(
        { ...mutation(row), destinationGroupId: destination.id },
        f.actor.id,
      ),
    ),
  );
  expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(
    1,
  );
  expect(raced.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "CAPACITY_EXCEEDED" },
  });
  const remaining = (
    await repository.list(
      {
        courseId: f.course.id,
        groupId: f.groups[0]!.id,
        page: 1,
        pageSize: 10,
      },
      f.actor.id,
    )
  ).items[0]!;
  const outcome = await Promise.allSettled([
    groups.cancel(destination.id, f.actor.id, destination.updatedAt),
    repository.transfer(
      { ...mutation(remaining), destinationGroupId: destination.id },
      f.actor.id,
    ),
  ]);
  expect(outcome[0]!.status).toBe("fulfilled");
  expect(
    (
      await repository.list(
        {
          courseId: f.course.id,
          groupId: destination.id,
          page: 1,
          pageSize: 10,
        },
        f.actor.id,
      )
    ).items.every((row) => row.state === "CANCELLED"),
  ).toBe(true);
});
test("actor role revocation denies idempotent retries and all private reads even with previously valid actor", async () => {
  const f = await fixture();
  const row = await repository.create(f.input, f.actor.id);
  await db
    .delete(schema.userRoles)
    .where(eq(schema.userRoles.userId, f.actor.id));
  await expect(repository.create(f.input, f.actor.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    repository.list({ page: 1, pageSize: 10 }, f.actor.id),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(repository.form(f.course.id, f.actor.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    repository.findParticipants("Synthetic", f.actor.id, 20),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    repository.recordPayment(
      {
        ...mutation(row),
        cash: { amountCents: 1, effectiveDate: null, reason: "Cash" },
      },
      f.actor.id,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("last published group guard preserves money; editorial withdrawal does not refund but permits explicit group cancellation", async () => {
  const f = await fixture();
  const row = await repository.create(f.input, f.actor.id);
  const groups = new DrizzleGroupRepository(db, () => now);
  await groups.cancel(f.groups[1]!.id, f.actor.id, f.groups[1]!.updatedAt);
  await expect(
    groups.cancel(f.groups[0]!.id, f.actor.id, f.groups[0]!.updatedAt),
  ).rejects.toMatchObject({ code: "COURSE_UNAVAILABLE" });
  expect(
    (await repository.detail(row.id, f.actor.id))!.registration.state,
  ).toBe("ACTIVE");
  await new DrizzleCourseRepository(db).transition(
    f.course.id,
    "DRAFT",
    f.actor.id,
  );
  const withdrawn = (await repository.detail(row.id, f.actor.id))!;
  expect(withdrawn.registration).toMatchObject({
    state: "ACTIVE",
    refundDueCents: 0,
    paidCents: 2001,
  });
  expect(withdrawn.ledger).toHaveLength(1);
  await groups.cancel(f.groups[0]!.id, f.actor.id, f.groups[0]!.updatedAt);
  expect(
    (await repository.detail(row.id, f.actor.id))!.registration,
  ).toMatchObject({ state: "CANCELLED", refundDueCents: 2001 });
  const [cancelledGroup] = await db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, f.groups[0]!.id));
  await expect(
    groups.delete(f.groups[0]!.id, f.actor.id, cancelledGroup!.updatedAt),
  ).rejects.toMatchObject({ code: "GROUP_PUBLISHED" });
});

test("ADMIN display labels use joined current course and Bolivia group schedule without changing financial snapshots", async () => {
  const f = await fixture();
  const row = await repository.create(f.input, f.actor.id);
  expect(row).toMatchObject({
    courseName: "Synthetic Course",
    groupName: "08:00–09:30",
  });
  const form = (await repository.form(f.course.id, f.actor.id))!;
  expect(form.course.name).toBe("Synthetic Course");
  expect(form.groups.find((group) => group.id === row.groupId)!.groupName).toBe(
    row.groupName,
  );
  const page = await repository.list(
    { courseId: f.course.id, page: 1, pageSize: 10 },
    f.actor.id,
  );
  expect(page.items[0]).toMatchObject({
    courseName: "Synthetic Course",
    groupName: "08:00–09:30",
  });
  await db
    .update(schema.courses)
    .set({ name: "Current course title" })
    .where(eq(schema.courses.id, f.course.id));
  const detail = (await repository.detail(row.id, f.actor.id))!;
  const refreshedPage = await repository.list(
    { courseId: f.course.id, page: 1, pageSize: 10 },
    f.actor.id,
  );
  expect(detail.registration.courseName).toBe("Current course title");
  expect(refreshedPage.items[0]!.courseName).toBe("Current course title");
  expect(detail.registration.price).toEqual(row.price);
  expect(refreshedPage.items[0]!.paidCents).toBe(row.paidCents);
  expect(refreshedPage.items[0]!.groupName).not.toBe(row.groupId);
});
