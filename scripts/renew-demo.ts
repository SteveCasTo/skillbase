import { createClient } from "@supabase/supabase-js";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { provisionPasswordInstructor } from "@/application/auth/provision-password-user";
import { requireRoles, resolveActiveUser } from "@/application/auth/authorize";
import { requirePassword } from "@/domain/auth/identity";
import {
  getLocalSupabaseEnvironment,
  getTestSupabaseEnvironment,
  type LocalSupabaseEnvironment,
} from "./supabase-local-env";
import {
  assertCanonicalLocalTarget,
  formats,
  renewalPlan,
  RESET_TABLES,
  SEED_OWNER,
  seedId,
  teachers,
} from "./renew-demo-plan";

type Database = ReturnType<typeof createDatabase>["db"];

/** Trusted development adapter; uses the same authorized application provisioner and atomic profile repository as the server API.
 * Server-owned Auth metadata is written at Auth creation, so email alone never establishes synthetic ownership.
 * Supabase Auth + PostgreSQL cannot share a transaction. An orphan owned identity is recovered, never deleted by email.
 */
export async function renewDemo(
  database: Database,
  environment: LocalSupabaseEnvironment,
  actorId: string,
  password: string,
  reset: boolean,
  now = new Date(),
) {
  if (environment.apiUrl === "http://127.0.0.1:55321") {
    assertCanonicalLocalTarget(environment.databaseUrl, environment.apiUrl);
  } else {
    const isolated = getTestSupabaseEnvironment();
    if (JSON.stringify(environment) !== JSON.stringify(isolated))
      throw new Error(
        "Seed target must be verified local or runner-owned isolated test stack",
      );
  }
  requirePassword(password);
  const repository = new DrizzleAuthUserRepository(database);
  const [row] = await database
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, actorId));
  if (!row?.authUserId) throw new Error("Existing active ADMIN required");
  const actor = await resolveActiveUser(repository, row.authUserId);
  requireRoles(actor, ["ADMIN"]);
  if (!reset) {
    const existingCourses = await database
      .select({ id: schema.courses.id })
      .from(schema.courses);
    const existingFormats = await database
      .select({ id: schema.courseTypes.id })
      .from(schema.courseTypes);
    const knownCourses = new Set(
      renewalPlan(now).map(({ course }) => course.id),
    );
    const knownFormats = new Set<string>(formats.map(({ id }) => id));
    if (
      existingCourses.some(({ id }) => !knownCourses.has(id)) ||
      existingFormats.some(({ id }) => !knownFormats.has(id))
    )
      throw new Error(
        "Application contains other data; explicit reviewed reset required",
      );
  }
  const auth = createClient(environment.apiUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminIdentity = await auth.auth.admin.getUserById(row.authUserId);
  if (adminIdentity.error || !adminIdentity.data.user)
    throw new Error("ADMIN Auth identity missing");
  const identities = [];
  for (let page = 1; ; page++) {
    const result = await auth.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error)
      throw new Error("Unable to inspect local Auth identities");
    identities.push(...result.data.users);
    if (result.data.users.length < 100) break;
  }
  // Preflight all email collisions before creating any accounts or resetting data.
  for (const teacher of teachers) {
    const identity = identities.find((user) => user.email === teacher.email);
    const [internal] = await database
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, teacher.email));
    if (
      (identity && identity.app_metadata.seed_owner !== SEED_OWNER) ||
      (internal && (!identity || internal.authUserId !== identity.id))
    )
      throw new Error("Unowned synthetic email collision; nothing reset");
  }
  const instructorIds: string[] = [];
  for (const teacher of teachers) {
    const identity = identities.find((user) => user.email === teacher.email);
    const existing = identity
      ? await repository.findByAuthUserId(identity.id)
      : null;
    if (existing) {
      if (
        existing.status !== "ACTIVE" ||
        existing.roles.length !== 1 ||
        existing.roles[0] !== "INSTRUCTOR" ||
        existing.authPrimaryProvider !== "EMAIL"
      )
        throw new Error("Owned instructor account has changed; nothing reset");
      const [profile] = await database
        .select()
        .from(schema.instructorProfiles)
        .where(eq(schema.instructorProfiles.id, existing.id));
      if (!profile)
        throw new Error("Owned instructor profile missing; nothing reset");
      instructorIds.push(existing.id);
    } else {
      const user = await provisionPasswordInstructor(
        repository,
        {
          async createConfirmedUser(email, credential) {
            if (identity) return identity.id;
            const result = await auth.auth.admin.createUser({
              email,
              password: credential,
              email_confirm: true,
              app_metadata: { seed_owner: SEED_OWNER },
            });
            return result.error ? null : (result.data.user?.id ?? null);
          },
          async removeCreatedUser(id) {
            // Compensation may delete ONLY a new identity created by this invocation, never a recovered one.
            if (!identity) await auth.auth.admin.deleteUser(id);
          },
        },
        actor.authUserId!,
        {
          email: teacher.email,
          name: `${teacher.firstName} ${teacher.lastName}`,
          password,
          profile: teacher,
        },
      );
      instructorIds.push(user.id);
    }
  }
  const plan = renewalPlan(now);
  await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(20260915, 4)`);
    await tx.execute(sql`select pg_advisory_xact_lock(20260915, 3)`);
    await tx.execute(sql`select pg_advisory_xact_lock(20260915, 1)`);
    const [active] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, actor.id))
      .for("update");
    const [role] = await tx
      .select()
      .from(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.userId, actor.id),
          eq(schema.userRoles.roleCode, "ADMIN"),
        ),
      );
    if (active?.status !== "ACTIVE" || !role)
      throw new Error("ADMIN no longer active");
    if (reset) {
      // Explicit allowlist, RESTRICT (no CASCADE), no Auth/profile/role/config/ledger/storage writes.
      // TRUNCATE intentionally bypasses immutable revision/published group DELETE triggers for this authorized local renewal.
      await tx.execute(
        sql.raw(
          `TRUNCATE TABLE ${RESET_TABLES.map((table) => `public.${table}`).join(", ")} RESTRICT`,
        ),
      );
    }
    for (const format of formats) {
      const [existing] = await tx
        .select()
        .from(schema.courseTypes)
        .where(eq(schema.courseTypes.id, format.id));
      if (!existing) {
        await tx
          .insert(schema.courseTypes)
          .values({ id: format.id, name: format.name });
        await tx.insert(schema.courseTypeRevisions).values({
          ...format,
          id: seedId(`revision:${format.id}`),
          courseTypeId: format.id,
          revisionNumber: 1,
        });
      }
    }
    for (const sample of plan) {
      const [existing] = await tx
        .select()
        .from(schema.courses)
        .where(eq(schema.courses.id, sample.course.id));
      if (existing) {
        const [marker] = await tx
          .select()
          .from(schema.auditEvents)
          .where(
            eq(schema.auditEvents.id, seedId(`audit:${sample.course.id}`)),
          );
        if (
          marker?.metadata.seedOwner !== SEED_OWNER ||
          marker.entityId !== sample.course.id
        )
          throw new Error("Unowned course ID collision");
        continue; // Never renew dates or overwrite manual edits without explicit reset.
      }
      await tx.insert(schema.courses).values({
        ...sample.course,
        instructorId: instructorIds[sample.teacher],
      });
      await tx.insert(schema.groups).values(sample.groups);
      await tx.insert(schema.courseInstructorHistory).values({
        courseId: sample.course.id,
        instructorId: instructorIds[sample.teacher]!,
        actorId: actor.id,
      });
      if (sample.interests.length)
        await tx.insert(schema.interestRegistrations).values(sample.interests);
      await tx.insert(schema.auditEvents).values({
        id: seedId(`audit:${sample.course.id}`),
        actorId: actor.id,
        entityType: "COURSE",
        entityId: sample.course.id,
        action: "DEMO_SEEDED",
        metadata: { seedOwner: SEED_OWNER },
      });
    }
  });
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (
      args.some(
        (arg) => !["--apply", "--reset-application-data"].includes(arg),
      ) ||
      (args.includes("--reset-application-data") && !args.includes("--apply"))
    )
      throw new Error(
        "Use no flags for plan, --apply for insert-only, or --apply --reset-application-data for local renewal",
      );
    const plan = renewalPlan(new Date());
    console.info(
      JSON.stringify(
        {
          owner: SEED_OWNER,
          formats: 2,
          instructors: 3,
          courses: 6,
          published: 5,
          drafts: 1,
          groups: 12,
          activeInterests: plan
            .flatMap(({ interests }) => interests)
            .filter(({ status }) => status === "ACTIVE").length,
          cancelledInterests: plan
            .flatMap(({ interests }) => interests)
            .filter(({ status }) => status === "CANCELLED").length,
          dates: plan.map(({ course }) => ({
            slug: course.slug,
            startsAt: course.startsAt,
            endsAt: course.endsAt,
          })),
          resetTables: RESET_TABLES,
          preserved:
            "All Auth identities/sessions, users, roles, instructor profiles, Auth configuration, migration ledger and Storage",
        },
        null,
        2,
      ),
    );
    if (args.includes("--apply")) {
      if (
        process.env.CI ||
        process.env.VERCEL ||
        process.env.NODE_ENV === "production"
      )
        throw new Error("Manual local execution only");
      const url = process.env.DATABASE_URL ?? "";
      const api = process.env.PUBLIC_SUPABASE_URL ?? "";
      assertCanonicalLocalTarget(url, api);
      const password = process.env.SEED_INSTRUCTOR_PASSWORD ?? "";
      requirePassword(password);
      const actor = process.env.SEED_ADMIN_ID ?? "";
      if (!/^[0-9a-f-]{36}$/iu.test(actor))
        throw new Error("SEED_ADMIN_ID must identify an existing active ADMIN");
      const environment = getLocalSupabaseEnvironment();
      assertCanonicalLocalTarget(environment.databaseUrl, environment.apiUrl);
      if (url !== environment.databaseUrl)
        throw new Error(
          "DATABASE_URL must exactly match running local Supabase identity",
        );
      const database = createDatabase(url);
      try {
        await renewDemo(
          database.db,
          environment,
          actor,
          password,
          args.includes("--reset-application-data"),
        );
      } finally {
        await database.close();
      }
      console.info(
        "Synthetic local seed completed; credentials and identities withheld.",
      );
    }
  } catch {
    console.error(
      "Local demo renewal refused or failed. No credentials or database errors printed. Check local target, active ADMIN, external password, migrations 0014 and synthetic ownership; do not reset Auth.",
    );
    process.exitCode = 1;
  }
}
