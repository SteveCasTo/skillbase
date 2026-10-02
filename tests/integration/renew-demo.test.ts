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
  try {
    // Simulate interruption after owned Auth creation but before internal profile commit.
    const orphan = await auth.auth.admin.createUser({
      email: teachers[0].email,
      password,
      email_confirm: true,
      app_metadata: { seed_owner: SEED_OWNER },
    });
    expect(orphan.error).toBeNull();
    await renewDemo(database.db, environment, admin!.id, password, true);
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
    await database.close();
  }
}, 120000);
