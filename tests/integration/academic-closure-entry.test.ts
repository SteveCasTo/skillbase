import { afterAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DrizzleClosureRepository } from "@/server/db/repositories/academic-closure-repository";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";
import type { CreateRegistrationInput } from "@/domain/pre-registrations/types";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createClosureFixture } from "../fixtures/academic-closure";
import { evaluationFixtureTables } from "../fixtures/evaluation-cleanup";

const connection = createDatabase(getTestSupabaseEnvironment().databaseUrl, {
  max: 8,
});
const db = connection.db;
const now = new Date("2099-02-01T12:00:00Z");
const clock = () => now;
const repo = new DrizzleClosureRepository(db, clock);
const finance = createRegistrationRepository(db, clock);
afterAll(async () => {
  await db.execute(
    sql`truncate ${evaluationFixtureTables}, participant_attendance, instructor_attendance, session_roster, attendance_command_receipts, group_sessions, registration_ledger, registration_command_receipts, pre_registrations, participants restrict`,
  );
  await connection.close();
});
async function fixture() {
  const f = await createClosureFixture(db, clock);
  // The normal F5 window remains open. ADMIN resolves every future encounter
  // without inventing marks; pre-start registrations are not INSCRITO yet.
  for (const session of f.calendar.sessions)
    await f.attendance.cancel(f.admin.id, {
      courseId: f.course.id,
      groupId: f.groups[0]!.id,
      sessionId: session.id,
      requestKey: crypto.randomUUID(),
      revision: session.revision,
      reason: "Synthetic early resolution",
    });
  const settings = await finance.settings(f.admin.id);
  const entry: CreateRegistrationInput = {
    courseId: f.course.id,
    groupId: f.groups[0]!.id,
    requestKey: crypto.randomUUID(),
    courseRevision: f.course.updatedAt.toISOString(),
    settingsRevision: settings.revision,
    firstDayException: false,
    sourceInterestId: null,
    participantType: "STUDENT",
    participant: {
      ci: `ENTRY-${crypto.randomUUID()}`,
      firstName: "Synthetic",
      lastName: "Entry",
      email: "entry@test.invalid",
      phone: null,
    },
    initialPayment: {
      amountCents: 8000,
      effectiveDate: null,
      reason: "Synthetic cash",
    },
  };
  const close = {
    courseId: f.course.id,
    groupId: f.groups[0]!.id,
    requestKey: crypto.randomUUID(),
    revision: 0,
  };
  return { ...f, entry, close };
}
async function evidence() {
  return {
    participants: await db.select().from(s.participants),
    registrations: await db.select().from(s.preRegistrations),
    receipts: await db.select().from(s.registrationCommandReceipts),
    ledger: await db.select().from(s.registrationLedger),
    audit: await db.select().from(s.auditEvents),
  };
}
test("academic closed target rejects create and transfer atomically, preserves replay, and permits entry after reopening", async () => {
  const f = await fixture();
  const prior = await finance.create(f.entry, f.admin.id);
  const closed = await repo.close(f.admin.id, f.close);
  expect(closed.status).toBe("CLOSED");
  const original = await repo.getVersion(
    f.admin.id,
    f.course.id,
    f.close.groupId,
    1,
  );
  const before = await evidence();
  const rejectedEntry = {
    ...f.entry,
    requestKey: crypto.randomUUID(),
    participant: {
      ...f.entry.participant,
      ci: `DENIED-${crypto.randomUUID()}`,
    },
  };
  await expect(finance.create(rejectedEntry, f.admin.id)).rejects.toMatchObject(
    { code: "GROUP_CLOSED", issues: { groupId: expect.any(String) } },
  );
  const transfer = {
    registrationId: f.otherGroup.id,
    destinationGroupId: f.close.groupId,
    revision: f.otherGroup.revision,
    requestKey: crypto.randomUUID(),
  };
  await expect(finance.transfer(transfer, f.admin.id)).rejects.toMatchObject({
    code: "GROUP_CLOSED",
    issues: { destinationGroupId: expect.any(String) },
  });
  expect(await evidence()).toEqual(before);
  expect(await finance.create(f.entry, f.admin.id)).toEqual(prior);
  expect(await evidence()).toEqual(before);
  // Source closure is not a new transfer-out restriction: existing F5 policy
  // still permits this pre-start movement into an open destination.
  const outgoing = await finance.transfer(
    {
      registrationId: f.paid.id,
      destinationGroupId: f.groups[1]!.id,
      revision: f.paid.revision,
      requestKey: crypto.randomUUID(),
    },
    f.admin.id,
  );
  expect(outgoing.groupId).toBe(f.groups[1]!.id);
  await repo.reopen(f.admin2.id, {
    ...f.close,
    revision: 1,
    requestKey: crypto.randomUUID(),
    reason: "Autorizar ingresos con revisión",
  });
  expect((await finance.create(rejectedEntry, f.admin.id)).groupId).toBe(
    f.close.groupId,
  );
  const moved = await finance.transfer(transfer, f.admin.id);
  expect(moved.groupId).toBe(f.close.groupId);
  await repo.close(f.admin.id, {
    ...f.close,
    revision: 2,
    requestKey: crypto.randomUUID(),
  });
  const replayEvidence = await evidence();
  expect(await finance.transfer(transfer, f.admin.id)).toEqual(moved);
  expect(await evidence()).toEqual(replayEvidence);
  expect(
    await repo.getVersion(f.admin.id, f.course.id, f.close.groupId, 1),
  ).toEqual(original);
});
test("academic closed target serializes closure against concurrent entry and transfer without orphan cash or receipts", async () => {
  const f = await fixture();
  const transfer = {
    registrationId: f.otherGroup.id,
    destinationGroupId: f.close.groupId,
    revision: f.otherGroup.revision,
    requestKey: crypto.randomUUID(),
  };
  const before = await evidence();
  const outcomes = await Promise.allSettled([
    repo.close(f.admin.id, f.close),
    finance.create(f.entry, f.admin.id),
    finance.transfer(transfer, f.admin.id),
  ]);
  expect(outcomes[0]!.status).toBe("fulfilled");
  expect(
    (await repo.getGroup(f.admin.id, f.course.id, f.close.groupId)).status,
  ).toBe("CLOSED");
  const after = await evidence();
  const created = outcomes[1]!.status === "fulfilled";
  const transferred = outcomes[2]!.status === "fulfilled";
  expect(after.participants.length - before.participants.length).toBe(
    created ? 1 : 0,
  );
  expect(after.registrations.length - before.registrations.length).toBe(
    created ? 1 : 0,
  );
  expect(after.ledger.length - before.ledger.length).toBe(created ? 1 : 0);
  expect(after.receipts.length - before.receipts.length).toBe(
    Number(created) + Number(transferred),
  );
  expect(
    (
      await db
        .select()
        .from(s.preRegistrations)
        .where(eq(s.preRegistrations.id, f.otherGroup.id))
    )[0]!.groupId,
  ).toBe(transferred ? f.close.groupId : f.groups[1]!.id);
  for (const result of outcomes.slice(1))
    if (result.status === "rejected")
      expect(result.reason).toMatchObject({ code: "GROUP_CLOSED" });
  const stable = await evidence();
  await expect(
    finance.create(
      {
        ...f.entry,
        requestKey: crypto.randomUUID(),
        participant: {
          ...f.entry.participant,
          ci: `LATE-${crypto.randomUUID()}`,
        },
      },
      f.admin.id,
    ),
  ).rejects.toMatchObject({ code: "GROUP_CLOSED" });
  expect(await evidence()).toEqual(stable);
});
