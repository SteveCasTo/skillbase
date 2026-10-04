import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { renewDemo } from "../../scripts/renew-demo";
import { teachers, SEED_OWNER } from "../../scripts/renew-demo-plan";
import { DrizzleCourseRepository } from "@/server/db/repositories/course-repository";

test("isolated renewal preserves ADMIN identity/session and all accounts, reruns without Auth duplicates", async () => {
  const environment = getTestSupabaseEnvironment();
  const database = createDatabase(environment.databaseUrl);
  const auth = createClient(environment.apiUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const password = `Aa1!${randomBytes(24).toString("hex")}`;
  const email = `renew-admin-${crypto.randomUUID()}@example.test`;
  const created = await auth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const authId = created.data.user!.id;
  const login = createClient(environment.apiUrl, environment.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await login.auth.signInWithPassword({ email, password });
  expect(signed.error).toBeNull();
  const [admin] = await database.db
    .insert(schema.users)
    .values({
      email,
      name: "Isolated renewal admin",
      status: "ACTIVE",
      authUserId: authId,
      authPrimaryProvider: "EMAIL",
    })
    .returning();
  await database.db
    .insert(schema.userRoles)
    .values({ userId: admin!.id, roleCode: "ADMIN" });
  const [standaloneParticipant] = await database.db
    .insert(schema.participants)
    .values({
      ci: `GLOBAL-${crypto.randomUUID().toUpperCase()}`,
      firstName: "Global",
      lastName: "Preserved",
      email: "global@example.invalid",
    })
    .returning();
  const [originalSettings] = await database.db
    .select()
    .from(schema.registrationSettings)
    .where(eq(schema.registrationSettings.id, 1));
  try {
    expect(originalSettings).toBeDefined();
    const [globalSettings] = await database.db
      .update(schema.registrationSettings)
      .set({
        minimumPaymentPercent: 30,
        auxiliaryDiscountPercent: 100,
        revision: 2,
        updatedBy: admin!.id,
      })
      .where(eq(schema.registrationSettings.id, 1))
      .returning();
    // Simulate interruption after owned Auth creation but before internal profile commit.
    const orphan = await auth.auth.admin.createUser({
      email: teachers[0].email,
      password,
      email_confirm: true,
      app_metadata: { seed_owner: SEED_OWNER },
    });
    expect(orphan.error).toBeNull();
    await renewDemo(database.db, environment, admin!.id, password, true);
    expect(
      (
        await database.db
          .select()
          .from(schema.participants)
          .where(eq(schema.participants.id, standaloneParticipant!.id))
      )[0],
    ).toEqual(standaloneParticipant!);
    expect(
      (await database.db.select().from(schema.registrationSettings))[0],
    ).toEqual(globalSettings!);
    const before = await database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, admin!.id));
    const identities = (await auth.auth.admin.listUsers({ perPage: 1000 })).data
      .users;
    const owned = identities.filter(
      (u) => u.app_metadata.seed_owner === SEED_OWNER,
    );
    expect(owned).toHaveLength(3);
    expect(owned.some((user) => user.id === orphan.data.user!.id)).toBe(true);
    const teacherRows = await database.db
      .select()
      .from(schema.users)
      .where(sql`${schema.users.email} like 'demo.%@example.test'`);
    const datesBefore = await database.db.select().from(schema.courses);
    await renewDemo(
      database.db,
      environment,
      admin!.id,
      password,
      false,
      new Date("2030-01-01T12:00:00Z"),
    );
    expect(await database.db.select().from(schema.courses)).toEqual(
      datesBefore,
    );
    await renewDemo(database.db, environment, admin!.id, password, true);
    expect(
      await database.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, admin!.id)),
    ).toEqual(before);
    expect(
      await database.db
        .select()
        .from(schema.users)
        .where(sql`${schema.users.email} like 'demo.%@example.test'`),
    ).toEqual(teacherRows);
    expect(
      (await auth.auth.admin.listUsers({ perPage: 1000 })).data.users
        .filter((u) => u.app_metadata.seed_owner === SEED_OWNER)
        .map((u) => u.id)
        .sort(),
    ).toEqual(owned.map((u) => u.id).sort());
    expect(
      (await login.auth.getUser(signed.data.session!.access_token)).data.user
        ?.id,
    ).toBe(authId);
    expect(await database.db.select().from(schema.courses)).toHaveLength(6);
    expect(await database.db.select().from(schema.groups)).toHaveLength(12);
    expect(
      await database.db.select().from(schema.interestRegistrations),
    ).toHaveLength(35);
    for (const teacher of teachers)
      expect(
        teacherRows.some(
          (u) => u.email === teacher.email && u.status === "ACTIVE",
        ),
      ).toBe(true);
    const courseRepository = new DrizzleCourseRepository(database.db);
    for (const course of await database.db.select().from(schema.courses)) {
      if (course.status === "PUBLISHED")
        await courseRepository.transition(course.id, "DRAFT", admin!.id);
      await courseRepository.transition(course.id, "PUBLISHED", admin!.id);
    }
    // Existing owned accounts still authenticate using the external credential.
    const instructorLogin = createClient(
      environment.apiUrl,
      environment.publishableKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(
      (
        await instructorLogin.auth.signInWithPassword({
          email: teachers[0].email,
          password,
        })
      ).error,
    ).toBeNull();
    await auth.auth.admin.updateUserById(owned[0]!.id, {
      app_metadata: { seed_owner: "unowned" },
    });
    let refused = false;
    try {
      await renewDemo(database.db, environment, admin!.id, password, true);
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
    expect(await database.db.select().from(schema.courses)).toHaveLength(6);
    expect(
      await database.db.select().from(schema.interestRegistrations),
    ).toHaveLength(35);
    expect(
      (await login.auth.getUser(signed.data.session!.access_token)).data.user
        ?.id,
    ).toBe(authId);
  } finally {
    try {
      // Restore the runner-owned singleton even if a preservation assertion fails.
      if (originalSettings)
        await database.db
          .update(schema.registrationSettings)
          .set(originalSettings)
          .where(eq(schema.registrationSettings.id, 1));
    } finally {
      await database.close();
    }
  }
}, 120000);

test("isolated demo reset refuses CANCELLED cash history without changing legacy data, global identity/config or Auth", async () => {
  const environment = getTestSupabaseEnvironment();
  const database = createDatabase(environment.databaseUrl);
  const db = database.db;
  const auth = createClient(environment.apiUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const [actor] = await db
      .insert(schema.users)
      .values({
        email: `financial-guard-${crypto.randomUUID()}@test.invalid`,
        name: "Synthetic guard admin",
        status: "ACTIVE",
        authUserId: crypto.randomUUID(),
      })
      .returning();
    await db
      .insert(schema.userRoles)
      .values({ userId: actor!.id, roleCode: "ADMIN" });
    const [format] = await db
      .insert(schema.courseTypes)
      .values({ name: `Protected ${crypto.randomUUID()}` })
      .returning();
    const [revision] = await db
      .insert(schema.courseTypeRevisions)
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
      .insert(schema.courses)
      .values({
        name: "Protected financial course",
        slug: `protected-${crypto.randomUUID()}`,
        description: "Synthetic history",
        level: "BASIC",
        courseTypeRevisionId: revision!.id,
        schedule: "Lunes a viernes",
        conditions: "Synthetic",
        minimumGrade: 50,
        status: "DRAFT",
        startsAt: new Date("2099-03-02T04:00:00Z"),
        endsAt: new Date("2099-03-20T04:00:00Z"),
      })
      .returning();
    const [group] = await db
      .insert(schema.groups)
      .values({
        courseId: course!.id,
        courseTypeRevisionId: revision!.id,
        capacity: 1,
        startsAt: new Date("2099-03-02T22:00:00Z"),
        endsAt: new Date("2099-03-20T23:30:00Z"),
      })
      .returning();
    const [person] = await db
      .insert(schema.participants)
      .values({
        ci: `PROTECTED-${crypto.randomUUID().toUpperCase()}`,
        firstName: "Protected",
        lastName: "Person",
        email: "protected@example.invalid",
      })
      .returning();
    const [registration] = await db
      .insert(schema.preRegistrations)
      .values({
        participantId: person!.id,
        courseId: course!.id,
        groupId: group!.id,
        courseTypeRevisionId: revision!.id,
        participantType: "STUDENT",
        settingsRevision: 1,
        basePriceCents: "8000",
        discountPercent: 0,
        totalPriceCents: "8000",
        minimumPaymentPercent: 25,
        minimumPaymentCents: "2000",
        createdBy: actor!.id,
        state: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: actor!.id,
        cancellationReason: "VOLUNTARY",
        cancellationNote: "Synthetic retained history",
      })
      .returning();
    const [receipt] = await db
      .insert(schema.registrationCommandReceipts)
      .values({
        actorId: actor!.id,
        requestKey: crypto.randomUUID(),
        operation: "PAYMENT",
        fingerprint: "b".repeat(64),
        result: {
          minimumPaymentPercent: 25,
          auxiliaryDiscountPercent: 50,
          revision: 1,
        },
      })
      .returning();
    const [payment] = await db
      .insert(schema.registrationLedger)
      .values({
        registrationId: registration!.id,
        commandReceiptId: receipt!.id,
        actorId: actor!.id,
        kind: "PAYMENT",
        amountCents: "2000",
        effectiveDate: "2026-10-02",
        reason: "Actual synthetic cash",
      })
      .returning();
    const before = {
      courses: await db.select().from(schema.courses),
      groups: await db.select().from(schema.groups),
      interests: await db.select().from(schema.interestRegistrations),
      participants: await db.select().from(schema.participants),
      settings: await db.select().from(schema.registrationSettings),
      authIds: (await auth.auth.admin.listUsers({ perPage: 1000 })).data.users
        .map((u) => u.id)
        .sort(),
    };
    let refused: unknown;
    try {
      await renewDemo(
        db,
        environment,
        actor!.id,
        `Aa1!${randomBytes(24).toString("hex")}`,
        true,
      );
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).message).toContain(
      "registration or financial/idempotency history exists",
    );
    expect((refused as Error).message).toContain("Use insert-only renewal");
    expect(await db.select().from(schema.courses)).toEqual(before.courses);
    expect(await db.select().from(schema.groups)).toEqual(before.groups);
    expect(await db.select().from(schema.interestRegistrations)).toEqual(
      before.interests,
    );
    expect(await db.select().from(schema.participants)).toEqual(
      before.participants,
    );
    expect(await db.select().from(schema.registrationSettings)).toEqual(
      before.settings,
    );
    expect(
      (await auth.auth.admin.listUsers({ perPage: 1000 })).data.users
        .map((u) => u.id)
        .sort(),
    ).toEqual(before.authIds);
    expect(
      (
        await db
          .select()
          .from(schema.preRegistrations)
          .where(eq(schema.preRegistrations.id, registration!.id))
      )[0],
    ).toEqual(registration!);
    expect(
      (
        await db
          .select()
          .from(schema.registrationLedger)
          .where(eq(schema.registrationLedger.id, payment!.id))
      )[0],
    ).toEqual(payment!);
    expect(
      (
        await db
          .select()
          .from(schema.registrationCommandReceipts)
          .where(eq(schema.registrationCommandReceipts.id, receipt!.id))
      )[0],
    ).toEqual(receipt!);
    const guard = await db.execute(
      sql`select tgenabled from pg_trigger where tgrelid = 'public.groups'::regclass and tgname = 'groups_protect_published'`,
    );
    expect(guard[0]?.tgenabled).toBe("O");
  } finally {
    await database.close();
  }
}, 120000);
