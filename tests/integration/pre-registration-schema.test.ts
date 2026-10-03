import { afterAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  courses,
  courseTypes,
  courseTypeRevisions,
  groups,
  interestRegistrations,
  participants,
  preRegistrations,
  registrationCommandReceipts,
  registrationLedger,
  registrationSettings,
  users,
} from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

const database = createDatabase(getTestSupabaseEnvironment().databaseUrl);
const db = database.db;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const rollback = new Error("phase5 schema intentional fixture rollback");
afterAll(async () => {
  await database.close();
});
/** Each test rolls back its own fixtures; append-only financial history is never deleted. */
async function isolated(
  run: (
    tx: Transaction,
    fixture: Awaited<ReturnType<typeof fixtures>>,
  ) => Promise<void>,
) {
  try {
    await db.transaction(async (tx) => {
      await run(tx, await fixtures(tx));
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
async function fixtures(tx: Transaction) {
  const [actor] = await tx
    .insert(users)
    .values({
      email: `phase5-${crypto.randomUUID()}@test.invalid`,
      name: "Synthetic Admin",
      authUserId: crypto.randomUUID(),
      status: "ACTIVE",
    })
    .returning();
  const [format] = await tx
    .insert(courseTypes)
    .values({ name: `Phase5 ${crypto.randomUUID()}` })
    .returning();
  const [revision] = await tx
    .insert(courseTypeRevisions)
    .values({
      courseTypeId: format!.id,
      revisionNumber: 1,
      totalHours: 20,
      sessionMinutes: 90,
      studentAmount: "80.01",
      externalAmount: "100.00",
    })
    .returning();
  const [course] = await tx
    .insert(courses)
    .values({
      name: "Schema fixture",
      slug: `phase5-${crypto.randomUUID()}`,
      description: "Synthetic only",
      level: "BASIC",
      courseTypeRevisionId: revision!.id,
      schedule: "Lunes a viernes",
      conditions: "Test only",
      startsAt: new Date("2099-03-02T04:00:00Z"),
      endsAt: new Date("2099-03-20T04:00:00Z"),
      minimumGrade: 50,
      status: "PUBLISHED",
    })
    .returning();
  const [group] = await tx
    .insert(groups)
    .values({
      courseId: course!.id,
      courseTypeRevisionId: revision!.id,
      capacity: 1,
      startsAt: new Date("2099-03-02T22:00:00Z"),
      endsAt: new Date("2099-03-20T23:30:00Z"),
      publishedAt: new Date(),
    })
    .returning();
  const [person] = await tx
    .insert(participants)
    .values({
      ci: `00AB-${crypto.randomUUID().toUpperCase()}`,
      firstName: "Synthetic",
      lastName: "Participant",
      email: "same@example.invalid",
    })
    .returning();
  const registration = {
    participantId: person!.id,
    courseId: course!.id,
    groupId: group!.id,
    courseTypeRevisionId: revision!.id,
    participantType: "AUXILIARY" as const,
    settingsRevision: 1,
    basePriceCents: "8001",
    discountPercent: 50,
    totalPriceCents: "4001",
    minimumPaymentPercent: 25,
    minimumPaymentCents: "1001",
    createdBy: actor!.id,
  };
  return {
    actor: actor!,
    revision: revision!,
    course: course!,
    group: group!,
    person: person!,
    registration,
  };
}
/** Expected PostgreSQL errors are contained in savepoints, not the test's outer transaction. */
async function rejects(
  tx: Transaction,
  run: (savepoint: Transaction) => Promise<unknown>,
  code: string,
) {
  let caught: unknown;
  try {
    await tx.transaction(run);
  } catch (error) {
    caught = error;
  }
  const cause =
    caught && typeof caught === "object" && "cause" in caught
      ? caught.cause
      : caught;
  expect(cause).toMatchObject({ code });
}

test("phase5 schema migration enables private RLS without Data API privileges", async () => {
  const names = [
    "participants",
    "pre_registrations",
    "registration_settings",
    "registration_command_receipts",
    "registration_ledger",
  ];
  for (const name of names) {
    const rows = await db.execute(
      sql`select relrowsecurity from pg_class where oid = ${`public.${name}`}::regclass`,
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const grants = await db.execute(
        sql`select has_table_privilege(${role}, ${`public.${name}`}, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as permitted`,
      );
      expect(grants[0]?.permitted).toBe(false);
    }
  }
  const [settings] = await db.select().from(registrationSettings);
  expect(settings).toMatchObject({
    id: 1,
    minimumPaymentPercent: 25,
    auxiliaryDiscountPercent: 50,
    revision: 1,
  });
});
test("phase5 schema CI unique, conservative string identity and no unique email fusion", async () =>
  isolated(async (tx, f) => {
    await rejects(
      tx,
      (sp) =>
        sp.insert(participants).values({
          ci: f.person.ci,
          firstName: "Another",
          lastName: "Person",
          email: "other@example.invalid",
        }),
      "23505",
    );
    for (const ci of ["001 ab", "lowercase", ""])
      await rejects(
        tx,
        (sp) =>
          sp.insert(participants).values({
            ci,
            firstName: "Another",
            lastName: "Person",
            email: "other@example.invalid",
          }),
        "23514",
      );
    const [second] = await tx
      .insert(participants)
      .values({
        ci: "0000123A-LP",
        firstName: "Second",
        lastName: "Person",
        email: f.person.email,
      })
      .returning();
    expect(second!.ci).toBe("0000123A-LP");
    expect(second!.id).not.toBe(f.person.id);
  }));
test("phase5 schema one ACTIVE membership per person/course, cancellation retains row and permits new membership", async () =>
  isolated(async (tx, f) => {
    const [first] = await tx
      .insert(preRegistrations)
      .values(f.registration)
      .returning();
    await rejects(
      tx,
      (sp) => sp.insert(preRegistrations).values(f.registration),
      "23505",
    );
    await tx
      .update(preRegistrations)
      .set({
        state: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: f.actor.id,
        cancellationReason: "VOLUNTARY",
        cancellationNote: "Synthetic cancellation",
      })
      .where(eq(preRegistrations.id, first!.id));
    const [second] = await tx
      .insert(preRegistrations)
      .values(f.registration)
      .returning();
    expect(second!.id).not.toBe(first!.id);
    expect(
      await tx
        .select()
        .from(preRegistrations)
        .where(eq(preRegistrations.participantId, f.person.id)),
    ).toHaveLength(2);
    await rejects(
      tx,
      (sp) =>
        sp.delete(preRegistrations).where(eq(preRegistrations.id, first!.id)),
      "23514",
    );
    await rejects(
      tx,
      (sp) =>
        sp
          .update(preRegistrations)
          .set({
            state: "ACTIVE",
            cancelledAt: null,
            cancelledBy: null,
            cancellationReason: null,
            cancellationNote: null,
          })
          .where(eq(preRegistrations.id, first!.id)),
      "23514",
    );
  }));
test("phase5 schema same-course group/revision/origin FKs reject cross-course references", async () =>
  isolated(async (tx, f) => {
    const other = await fixtures(tx);
    await rejects(
      tx,
      (sp) =>
        sp
          .insert(preRegistrations)
          .values({ ...f.registration, groupId: other.group.id }),
      "23503",
    );
    await rejects(
      tx,
      (sp) =>
        sp.insert(preRegistrations).values({
          ...f.registration,
          courseTypeRevisionId: other.revision.id,
        }),
      "23503",
    );
    const [interest] = await tx
      .insert(interestRegistrations)
      .values({
        courseId: other.course.id,
        firstName: "Public",
        lastName: "Interest",
        email: "public@example.invalid",
      })
      .returning();
    await rejects(
      tx,
      (sp) =>
        sp
          .insert(preRegistrations)
          .values({ ...f.registration, sourceInterestId: interest!.id }),
      "23503",
    );
    await tx
      .insert(preRegistrations)
      .values({ ...other.registration, sourceInterestId: interest!.id });
    expect(
      (
        await tx
          .select()
          .from(interestRegistrations)
          .where(eq(interestRegistrations.id, interest!.id))
      )[0]!.status,
    ).toBe("ACTIVE");
  }));
test("phase5 schema exact snapshot checks half-up/ceil, free AUXILIARY and immutable commercial fields", async () =>
  isolated(async (tx, f) => {
    for (const changes of [
      { totalPriceCents: "4000" },
      { minimumPaymentCents: "1000" },
      { basePriceCents: "-1" },
      { discountPercent: 101 },
      { minimumPaymentPercent: 0 },
      { participantType: "STUDENT" as const },
    ])
      await rejects(
        tx,
        (sp) =>
          sp.insert(preRegistrations).values({ ...f.registration, ...changes }),
        "23514",
      );
    const [free] = await tx
      .insert(preRegistrations)
      .values({
        ...f.registration,
        discountPercent: 100,
        totalPriceCents: "0",
        minimumPaymentCents: "0",
      })
      .returning();
    expect(free!.totalPriceCents).toBe("0");
    await rejects(
      tx,
      (sp) =>
        sp
          .update(preRegistrations)
          .set({ settingsRevision: 2 })
          .where(eq(preRegistrations.id, free!.id)),
      "23514",
    );
    await rejects(
      tx,
      (sp) => sp.delete(participants).where(eq(participants.id, f.person.id)),
      "23503",
    );
    await rejects(
      tx,
      (sp) => sp.delete(users).where(eq(users.id, f.actor.id)),
      "23503",
    );
  }));
test("phase5 schema singleton configuration percent boundaries and actor-required revisions", async () =>
  isolated(async (tx, f) => {
    await rejects(
      tx,
      (sp) => sp.insert(registrationSettings).values({ id: 2 }),
      "23514",
    );
    for (const changes of [
      { minimumPaymentPercent: 0 },
      { minimumPaymentPercent: 101 },
      { auxiliaryDiscountPercent: -1 },
      { auxiliaryDiscountPercent: 101 },
      { revision: 2, updatedBy: null },
    ])
      await rejects(
        tx,
        (sp) =>
          sp
            .update(registrationSettings)
            .set(changes)
            .where(eq(registrationSettings.id, 1)),
        "23514",
      );
    const [settings] = await tx
      .update(registrationSettings)
      .set({
        minimumPaymentPercent: 100,
        auxiliaryDiscountPercent: 100,
        revision: 2,
        updatedBy: f.actor.id,
      })
      .where(eq(registrationSettings.id, 1))
      .returning();
    expect(settings!.auxiliaryDiscountPercent).toBe(100);
    const [registration] = await tx
      .insert(preRegistrations)
      .values(f.registration)
      .returning();
    expect(registration!.settingsRevision).toBe(1);
    expect(registration!.discountPercent).toBe(50);
  }));

test("phase5 schema cancellation requires explicit reason and amount precision stays bounded", async () =>
  isolated(async (tx, f) => {
    const [registration] = await tx
      .insert(preRegistrations)
      .values(f.registration)
      .returning();
    await rejects(
      tx,
      (sp) =>
        sp
          .update(preRegistrations)
          .set({
            state: "CANCELLED",
            cancelledAt: new Date(),
            cancelledBy: f.actor.id,
            cancellationReason: null,
            cancellationNote: "Missing reason",
          })
          .where(eq(preRegistrations.id, registration!.id)),
      "23514",
    );
    await rejects(
      tx,
      (sp) =>
        sp.insert(preRegistrations).values({
          ...f.registration,
          participantId: crypto.randomUUID(),
          basePriceCents: "1000000000000",
        }),
      "22003",
    );
  }));
test("phase5 schema cash ledger positive-only, immutable, actor/request audited and civil nonfuture date", async () =>
  isolated(async (tx, f) => {
    const [registration] = await tx
      .insert(preRegistrations)
      .values(f.registration)
      .returning();
    const receiptData = {
      actorId: f.actor.id,
      requestKey: crypto.randomUUID(),
      operation: "PAYMENT" as const,
      fingerprint: "a".repeat(64),
      result: {
        minimumPaymentPercent: 25,
        auxiliaryDiscountPercent: 50,
        revision: 1,
      },
    };
    const [receipt] = await tx
      .insert(registrationCommandReceipts)
      .values(receiptData)
      .returning();
    await rejects(
      tx,
      (sp) => sp.insert(registrationCommandReceipts).values(receiptData),
      "23505",
    );
    const cash = {
      registrationId: registration!.id,
      commandReceiptId: receipt!.id,
      kind: "PAYMENT" as const,
      amountCents: "1001",
      actorId: f.actor.id,
      effectiveDate: "2026-10-02",
      recordedAt: new Date("2026-10-03T03:59:59Z"),
      reason: "Synthetic cash",
    };
    const other = await fixtures(tx);
    await rejects(
      tx,
      (sp) =>
        sp
          .insert(registrationLedger)
          .values({ ...cash, actorId: other.actor.id }),
      "23503",
    );
    for (const amountCents of ["0", "-1"])
      await rejects(
        tx,
        (sp) => sp.insert(registrationLedger).values({ ...cash, amountCents }),
        "23514",
      );
    await rejects(
      tx,
      (sp) =>
        sp
          .insert(registrationLedger)
          .values({ ...cash, effectiveDate: "2026-10-03" }),
      "23514",
    );
    const [entry] = await tx
      .insert(registrationLedger)
      .values(cash)
      .returning();
    expect(entry!.amountCents).toBe("1001");
    expect(entry!.effectiveDate).toBe("2026-10-02");
    await rejects(
      tx,
      (sp) =>
        sp
          .update(registrationLedger)
          .set({ amountCents: "1" })
          .where(eq(registrationLedger.id, entry!.id)),
      "23514",
    );
    await rejects(
      tx,
      (sp) =>
        sp
          .delete(registrationLedger)
          .where(eq(registrationLedger.id, entry!.id)),
      "23514",
    );
    await rejects(
      tx,
      (sp) =>
        sp
          .delete(registrationCommandReceipts)
          .where(eq(registrationCommandReceipts.id, receipt!.id)),
      "23514",
    );
    await rejects(
      tx,
      (sp) => sp.insert(registrationLedger).values(cash),
      "23505",
    );
    await tx
      .update(preRegistrations)
      .set({
        state: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: f.actor.id,
        cancellationReason: "GROUP_CANCELLED",
        cancellationNote: "Synthetic group cancellation",
      })
      .where(eq(preRegistrations.id, registration!.id));
    const [refundReceipt] = await tx
      .insert(registrationCommandReceipts)
      .values({
        ...receiptData,
        requestKey: crypto.randomUUID(),
        operation: "REFUND",
      })
      .returning();
    const [refund] = await tx
      .insert(registrationLedger)
      .values({
        ...cash,
        commandReceiptId: refundReceipt!.id,
        kind: "REFUND",
        reason: "Cash physically returned",
      })
      .returning();
    expect(refund!.kind).toBe("REFUND");
    expect(refund!.amountCents).toBe("1001");
    // Later audited refund can update the optimistic revision without rewriting cancellation history.
    await tx
      .update(preRegistrations)
      .set({ updatedAt: new Date() })
      .where(eq(preRegistrations.id, registration!.id));
    expect(
      await tx
        .select()
        .from(registrationLedger)
        .where(eq(registrationLedger.registrationId, registration!.id)),
    ).toHaveLength(2);
  }));
