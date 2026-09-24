import { createClient } from "@supabase/supabase-js";
import { eq, inArray } from "drizzle-orm";

import type { AuthRole, UserStatus } from "@/domain/auth/types";
import { createDatabase } from "@/server/db/client";
import { auditEvents, courses, userRoles, users } from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

import { AUTH_FIXTURES } from "./auth-users";

interface InternalFixture {
  readonly email: string;
  readonly name: string;
  readonly roles: readonly AuthRole[];
  readonly status: UserStatus;
}

const internalFixtures: readonly InternalFixture[] = [
  { ...AUTH_FIXTURES.admin, roles: ["ADMIN"], status: "ACTIVE" },
  {
    ...AUTH_FIXTURES.instructor,
    roles: ["INSTRUCTOR"],
    status: "ACTIVE",
  },
  {
    ...AUTH_FIXTURES.multiRole,
    roles: ["ADMIN", "INSTRUCTOR"],
    status: "ACTIVE",
  },
  {
    ...AUTH_FIXTURES.mobileMultiRole,
    roles: ["ADMIN", "INSTRUCTOR"],
    status: "ACTIVE",
  },
  { ...AUTH_FIXTURES.futureRoute, roles: ["ADMIN"], status: "ACTIVE" },
  { ...AUTH_FIXTURES.originAdmin, roles: ["ADMIN"], status: "ACTIVE" },
  { ...AUTH_FIXTURES.logoutAdmin, roles: ["ADMIN"], status: "ACTIVE" },
  { ...AUTH_FIXTURES.disabled, roles: ["ADMIN"], status: "DISABLED" },
  { ...AUTH_FIXTURES.noRole, roles: [], status: "ACTIVE" },
];

export default async function setupAuthFixtures(): Promise<void> {
  const environment = getTestSupabaseEnvironment();
  const admin = createClient(environment.apiUrl, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const emails: string[] = Object.values(AUTH_FIXTURES).map(
    ({ email }) => email,
  );
  const existing: { id: string; email?: string }[] = [];
  const perPage = 50;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    existing.push(
      ...data.users.map(({ id, email }) => ({
        id,
        ...(email === undefined ? {} : { email }),
      })),
    );
    if (data.users.length < perPage) break;
  }
  for (const user of existing) {
    if (user.email && emails.includes(user.email)) {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw error;
    }
  }

  const database = createDatabase(environment.databaseUrl);
  try {
    await database.db.delete(auditEvents);
    await database.db.delete(courses);
    await database.db.delete(users).where(inArray(users.email, emails));

    const authIds = new Map<string, string>();
    for (const fixture of Object.values(AUTH_FIXTURES)) {
      const { data, error } = await admin.auth.admin.createUser({
        email: fixture.email,
        email_confirm: true,
      });
      if (error) throw error;
      authIds.set(fixture.email, data.user.id);
    }

    for (const fixture of internalFixtures) {
      const authUserId = authIds.get(fixture.email);
      if (!authUserId) throw new Error("Auth fixture was not created");
      const [created] = await database.db
        .insert(users)
        .values({ ...fixture, authUserId })
        .returning({ id: users.id });
      if (!created) throw new Error("Internal fixture was not created");
      if (fixture.roles.length > 0)
        await database.db
          .insert(userRoles)
          .values(
            fixture.roles.map((roleCode) => ({ userId: created.id, roleCode })),
          );
    }
    const [unknown] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, AUTH_FIXTURES.unknown.email));
    if (unknown)
      throw new Error("Unknown fixture must not have an internal user");
  } finally {
    await database.close();
  }
}
