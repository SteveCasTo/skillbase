import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { linkAuthenticatedInvitation } from "@/application/auth/link-invitation";
import { completeOAuthCallback } from "@/application/auth/complete-oauth-callback";
import { createDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { roles, userRoles, users } from "@/server/db/schema";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const database = createDatabase(connectionString);
const repository = new DrizzleAuthUserRepository(database.db);
const testDomain = "%@repository.test";

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

afterAll(async () => database.close());
beforeEach(async () => {
  await database.db.delete(users).where(sql`${users.email} like ${testDomain}`);
});

describe("auth user repository", () => {
  test("replaces invitation roles exactly and returns deterministic ordering", async () => {
    const invitation = await repository.preprovision({
      email: "  Multi@Repository.Test ",
      name: "Multi Role",
      roles: ["INSTRUCTOR", "ADMIN"],
    });
    expect(invitation.status).toBe("INVITED");
    expect(invitation.roles).toEqual(["ADMIN", "INSTRUCTOR"]);

    const replaced = await repository.preprovision({
      email: "multi@repository.test",
      name: "Instructor Only",
      roles: ["INSTRUCTOR"],
    });
    expect(replaced.name).toBe("Instructor Only");
    expect(replaced.roles).toEqual(["INSTRUCTOR"]);
  });

  test("rejects preprovision changes for active and disabled records", async () => {
    await repository.preprovision({
      email: "active@repository.test",
      name: "Active",
      roles: ["ADMIN"],
    });
    await linkAuthenticatedInvitation(repository, {
      authUserId: "10000000-0000-4000-8000-000000000001",
      email: "active@repository.test",
      emailVerified: true,
      provider: "google",
    });
    await database.db.insert(users).values({
      email: "disabled@repository.test",
      name: "Disabled",
      status: "DISABLED",
      authUserId: "10000000-0000-4000-8000-000000000002",
    });

    for (const email of [
      "active@repository.test",
      "disabled@repository.test",
    ]) {
      expect(
        await rejectedValue(
          repository.preprovision({
            email,
            name: "Changed",
            roles: ["INSTRUCTOR"],
          }),
        ),
      ).toMatchObject({ code: "INVITATION_NOT_EDITABLE" });
    }
  });

  test("handles unknown, disabled, repeated, same UUID and conflicting links", async () => {
    expect(
      await rejectedValue(
        linkAuthenticatedInvitation(repository, {
          authUserId: "20000000-0000-4000-8000-000000000001",
          email: "unknown@repository.test",
          emailVerified: true,
          provider: "google",
        }),
      ),
    ).toMatchObject({ code: "NOT_INVITED" });

    await database.db.insert(users).values({
      email: "disabled@repository.test",
      name: "Disabled",
      status: "DISABLED",
      authUserId: "20000000-0000-4000-8000-000000000002",
    });
    expect(
      await rejectedValue(
        linkAuthenticatedInvitation(repository, {
          authUserId: "20000000-0000-4000-8000-000000000002",
          email: "disabled@repository.test",
          emailVerified: true,
          provider: "google",
        }),
      ),
    ).toMatchObject({ code: "DISABLED" });

    await repository.preprovision({
      email: "repeat@repository.test",
      name: "Repeat",
      roles: ["ADMIN"],
    });
    const identity = {
      authUserId: "20000000-0000-4000-8000-000000000003",
      email: "repeat@repository.test",
      emailVerified: true,
      provider: "google" as const,
    };
    const first = await linkAuthenticatedInvitation(repository, identity);
    const repeated = await linkAuthenticatedInvitation(repository, identity);
    expect(repeated).toMatchObject({ id: first.id, status: "ACTIVE" });
    expect(
      await rejectedValue(
        linkAuthenticatedInvitation(repository, {
          ...identity,
          authUserId: "20000000-0000-4000-8000-000000000004",
        }),
      ),
    ).toMatchObject({ code: "IDENTITY_CONFLICT" });
  });

  test("serializes concurrent attempts to link one invitation", async () => {
    await repository.preprovision({
      email: "concurrent@repository.test",
      name: "Concurrent",
      roles: ["ADMIN"],
    });
    const firstDatabase = createDatabase(connectionString);
    const secondDatabase = createDatabase(connectionString);
    try {
      const attempts = await Promise.allSettled([
        new DrizzleAuthUserRepository(firstDatabase.db).linkVerifiedInvitation({
          authUserId: "30000000-0000-4000-8000-000000000001",
          email: "concurrent@repository.test",
          emailVerified: true,
          provider: "google",
        }),
        new DrizzleAuthUserRepository(secondDatabase.db).linkVerifiedInvitation(
          {
            authUserId: "30000000-0000-4000-8000-000000000002",
            email: "concurrent@repository.test",
            emailVerified: true,
            provider: "google",
          },
        ),
      ]);
      expect(
        attempts.filter(({ status }) => status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = attempts.find(({ status }) => status === "rejected");
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: { code: "IDENTITY_CONFLICT" },
      });
    } finally {
      await firstDatabase.close();
      await secondDatabase.close();
    }
  });

  test("orchestrates callback linking and rejection without Google UI", async () => {
    await repository.preprovision({
      email: "callback@repository.test",
      name: "Callback",
      roles: ["ADMIN"],
    });
    let signedOut = false;
    const result = await completeOAuthCallback(
      {
        exchangeCode: async (code) => code === "accepted",
        getIdentity: async () => ({
          authUserId: "35000000-0000-4000-8000-000000000001",
          email: "callback@repository.test",
          emailVerified: true,
          providers: ["google"],
        }),
        signOutCurrent: async () => {
          signedOut = true;
        },
      },
      repository,
      "accepted",
    );
    expect(result).toEqual({ success: true });
    expect(signedOut).toBe(false);
    expect(
      await repository.findByAuthUserId("35000000-0000-4000-8000-000000000001"),
    ).toMatchObject({ email: "callback@repository.test", status: "ACTIVE" });
  });

  test("enforces uniqueness, checks, foreign keys and role membership", async () => {
    const invitation = await repository.preprovision({
      email: "constraints@repository.test",
      name: "Constraints",
      roles: ["ADMIN"],
    });
    const invalidWrites: ReadonlyArray<() => Promise<unknown>> = [
      () =>
        database.db
          .insert(users)
          .values({ email: "constraints@repository.test", name: "Duplicate" })
          .execute(),
      () =>
        database.db
          .insert(users)
          .values({ email: "Not-Normalized@Repository.Test", name: "Invalid" })
          .execute(),
      () =>
        database.db
          .insert(users)
          .values({
            email: "active-no-id@repository.test",
            name: "Invalid",
            status: "ACTIVE",
          })
          .execute(),
      () =>
        database.db
          .insert(users)
          .values({
            email: "invited-with-id@repository.test",
            name: "Invalid",
            authUserId: "40000000-0000-4000-8000-000000000001",
          })
          .execute(),
      () =>
        database.db
          .insert(userRoles)
          .values({
            userId: "40000000-0000-4000-8000-000000000002",
            roleCode: "ADMIN",
          })
          .execute(),
      () =>
        database.db
          .insert(userRoles)
          .values({ userId: invitation.id, roleCode: "UNKNOWN" })
          .execute(),
      () => database.db.insert(roles).values({ code: "UNKNOWN" }).execute(),
      () =>
        database.db
          .insert(userRoles)
          .values({ userId: invitation.id, roleCode: "ADMIN" })
          .execute(),
    ];
    for (const write of invalidWrites)
      expect(await rejectedValue(write())).toBeInstanceOf(Error);

    await database.db.insert(users).values({
      email: "auth-one@repository.test",
      name: "One",
      status: "ACTIVE",
      authUserId: "40000000-0000-4000-8000-000000000003",
    });
    expect(
      await rejectedValue(
        database.db
          .insert(users)
          .values({
            email: "auth-two@repository.test",
            name: "Two",
            status: "ACTIVE",
            authUserId: "40000000-0000-4000-8000-000000000003",
          })
          .execute(),
      ),
    ).toBeInstanceOf(Error);
  });

  test("keeps RLS and explicit Data API privilege posture", async () => {
    const rls = await database.db.execute<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      sql`select relname, relrowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relname in ('users', 'roles', 'user_roles') order by relname`,
    );
    expect(rls).toHaveLength(3);
    expect(rls.every(({ relrowsecurity }) => relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated", "service_role"])
      expect(
        (
          await database.db.execute<{ allowed: boolean }>(
            sql`select has_table_privilege(${role}, 'public.users', 'select') as allowed`,
          )
        )[0]?.allowed,
      ).toBe(false);
  });
});
