import { afterAll, beforeAll, expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createDatabase, withRequestDatabase } from "@/server/db/client";
import { users, userRoles, authGoogleLinkRequests } from "@/server/db/schema";
import { createInstructorAccount } from "@/server/auth/provision-instructor";
import { loadRequestAuthContext } from "@/server/auth/context";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { consumeAuthAttempt } from "@/server/auth/security";
import { signAuthProof } from "@/server/auth/security";
import { finishGoogleAssociation } from "@/server/auth/google-association";
import {
  attachGoogleFixture,
  oauthFixtureClient,
  prepareOAuthFixtureCode,
} from "../fixtures/oauth-provider";
const environment = getTestSupabaseEnvironment();
const database = createDatabase(environment.databaseUrl);
const repository = new DrizzleAuthUserRepository(database.db);
const provider = createClient(environment.apiUrl, environment.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const password = "Synthetic-Integration-Password-2026";
const authIds: string[] = [];
let adminId = "";
const savedServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
beforeAll(async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = environment.serviceRoleKey;
  const { data, error } = await provider.auth.admin.createUser({
    email: "admin@dual-auth.test",
    email_confirm: true,
    password,
  });
  if (error || !data.user) throw new Error("Fixture creation failed");
  adminId = data.user.id;
  authIds.push(adminId);
  const [admin] = await database.db
    .insert(users)
    .values({
      email: "admin@dual-auth.test",
      name: "Dual Auth Admin",
      authUserId: adminId,
      status: "ACTIVE",
    })
    .returning();
  await database.db
    .insert(userRoles)
    .values({ userId: admin!.id, roleCode: "ADMIN" });
});
afterAll(async () => {
  await database.db
    .delete(users)
    .where(sql`${users.email} like '%@dual-auth.test'`);
  for (const id of authIds) await provider.auth.admin.deleteUser(id);
  if (savedServiceKey === undefined)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = savedServiceKey;
  await database.close();
});
test("server-only ADMIN helper provisions password instructor and provider metadata cannot grant ADMIN", async () => {
  const instructor = await withRequestDatabase(
    () =>
      createInstructorAccount(adminId, {
        email: " INSTRUCTOR@dual-auth.test ",
        name: "Password Instructor",
        password,
      }),
    undefined,
    environment.databaseUrl,
  );
  authIds.push(instructor.authUserId!);
  expect(instructor.status).toBe("ACTIVE");
  expect(instructor.roles).toEqual(["INSTRUCTOR"]);
  expect(instructor.approvedGoogleIdentityId).toBeNull();
  await provider.auth.admin.updateUserById(instructor.authUserId!, {
    user_metadata: { roles: ["ADMIN"], status: "ACTIVE" },
  });
  const client = createClient(environment.apiUrl, environment.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.auth.signInWithPassword({
    email: instructor.email,
    password,
  });
  expect(result.error).toBeNull();
  const context = await loadRequestAuthContext(client, repository);
  expect(context.internalUser?.id).toBe(instructor.id);
  expect(context.internalUser?.roles).toEqual(["INSTRUCTOR"]);
  await expect(
    withRequestDatabase(
      () =>
        createInstructorAccount(instructor.authUserId!, {
          email: "forbidden@dual-auth.test",
          name: "Forbidden",
          password,
        }),
      undefined,
      environment.databaseUrl,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await database.db
    .update(users)
    .set({ status: "DISABLED" })
    .where(eq(users.id, instructor.id));
  expect((await loadRequestAuthContext(client, repository)).error?.code).toBe(
    "DISABLED",
  );
  await client.auth.signOut({ scope: "local" });
});
test("duplicate provisioning does not overwrite another identity or expose provider details", async () => {
  await expect(
    withRequestDatabase(
      () =>
        createInstructorAccount(adminId, {
          email: "admin@dual-auth.test",
          name: "Replacement",
          password,
        }),
      undefined,
      environment.databaseUrl,
    ),
  ).rejects.toThrow("No pudimos crear");
  const admin = await repository.findByAuthUserId(adminId);
  expect(admin?.name).toBe("Dual Auth Admin");
  expect(admin?.roles).toEqual(["ADMIN"]);
});

test("real signed password sessions survive unsolicited Google attachment while real OAuth sessions wait for explicit approval", async () => {
  const instructor = await withRequestDatabase(
    () =>
      createInstructorAccount(adminId, {
        email: "association@dual-auth.test",
        name: "Association Owner",
        password,
      }),
    undefined,
    environment.databaseUrl,
  );
  authIds.push(instructor.authUserId!);
  expect(instructor.authPrimaryProvider).toBe("EMAIL");
  const owner = oauthFixtureClient();
  const login = await owner.client.auth.signInWithPassword({
    email: instructor.email,
    password,
  });
  expect(login.error).toBeNull();
  const googleId = await attachGoogleFixture(
    instructor.authUserId!,
    instructor.email,
  );
  const ownerContext = await loadRequestAuthContext(owner.client, repository);
  expect(ownerContext.internalUser?.id).toBe(instructor.id);
  expect(ownerContext.session?.method).toBe("PASSWORD");

  const oauth = oauthFixtureClient();
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  oauth.setVerifier(verifier);
  const code = await prepareOAuthFixtureCode(instructor.authUserId!, verifier);
  const exchanged = await oauth.client.auth.exchangeCodeForSession(code);
  if (exchanged.error || !exchanged.data.session)
    throw new Error("Isolated OAuth session fixture exchange failed");
  const oauthContext = await loadRequestAuthContext(oauth.client, repository);
  expect(oauthContext.internalUser).toBeNull();
  expect(oauthContext.error?.code).toBe("IDENTITY_CONFLICT");
  const claims = await oauth.client.auth.getClaims();
  expect(claims.data?.claims.amr).toMatchObject([{ method: "oauth" }]);
  const token = exchanged.data.session.access_token;
  const parts = token.split(".");
  const forged = await oauth.client.auth.getClaims(
    `${parts[0]}.${parts[1]}.${"x".repeat(parts[2]!.length)}`,
  );
  expect(forged.error).not.toBeNull();

  // Native callers can remove an identity. Persisted EMAIL provenance, not the
  // current identity count, prevents this from becoming a legacy Google grant.
  const { data: user } = await oauth.client.auth.getUser();
  const emailIdentity = user.user?.identities?.find(
    (entry) => entry.provider === "email",
  );
  if (!emailIdentity) throw new Error("Email identity fixture is unavailable");
  const unlink = await oauth.client.auth.unlinkIdentity(emailIdentity);
  expect(unlink.error).toBeNull();
  expect(
    (await loadRequestAuthContext(oauth.client, repository)).internalUser,
  ).toBeNull();
  expect(
    (await loadRequestAuthContext(owner.client, repository)).internalUser?.id,
  ).toBe(instructor.id);
  const renewed = await owner.client.auth.signInWithPassword({
    email: instructor.email,
    password,
  });
  expect(renewed.error).toBeNull();
  const original = await loadRequestAuthContext(owner.client, repository);
  expect(original.session?.method).toBe("PASSWORD");
  const nonce = crypto.randomUUID();
  await repository.createGoogleLinkRequest(
    nonce,
    instructor.id,
    original.session!.id,
  );
  const confirmationVerifier = crypto.randomUUID() + crypto.randomUUID();
  owner.setVerifier(confirmationVerifier);
  const confirmationCode = await prepareOAuthFixtureCode(
    instructor.authUserId!,
    confirmationVerifier,
  );
  const proof = signAuthProof(
    JSON.stringify({
      authUserId: instructor.authUserId,
      sessionId: original.session!.id,
      nonce,
      flowId: owner.flowId,
      existingGoogleIdentityIds: [googleId],
    }),
  );
  expect(
    await finishGoogleAssociation(
      owner.client,
      repository,
      proof,
      confirmationCode,
    ),
  ).toBe("/app/perfil?status=linked");
  expect(
    (await repository.findByAuthUserId(instructor.authUserId!))
      ?.approvedGoogleIdentityId,
  ).toBe(googleId);
  expect(
    (await loadRequestAuthContext(owner.client, repository)).session?.method,
  ).toBe("OAUTH");
  expect(
    (await loadRequestAuthContext(oauth.client, repository)).internalUser?.id,
  ).toBe(instructor.id);
  const passwordAgain = oauthFixtureClient();
  await passwordAgain.client.auth.signInWithPassword({
    email: instructor.email,
    password,
  });
  expect(
    (await loadRequestAuthContext(passwordAgain.client, repository))
      .internalUser?.id,
  ).toBe(instructor.id);
  await owner.client.auth.signOut({ scope: "local" });
  await oauth.client.auth.signOut({ scope: "local" });
  await passwordAgain.client.auth.signOut({ scope: "local" });
}, 30_000);

test("Google link nonces are session/owner-bound, single-use, expiring and not Data API accessible", async () => {
  const admin = await repository.findByAuthUserId(adminId);
  const sessionId = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  await repository.createGoogleLinkRequest(nonce, admin!.id, sessionId);
  expect(
    await repository.consumeGoogleLinkRequest(
      nonce,
      admin!.id,
      crypto.randomUUID(),
    ),
  ).toBe(false);
  expect(
    await repository.consumeGoogleLinkRequest(
      nonce,
      crypto.randomUUID(),
      sessionId,
    ),
  ).toBe(false);
  const results = await Promise.all([
    repository.consumeGoogleLinkRequest(nonce, admin!.id, sessionId),
    repository.consumeGoogleLinkRequest(nonce, admin!.id, sessionId),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  await repository.createGoogleLinkRequest(nonce, admin!.id, sessionId);
  await database.db
    .update(authGoogleLinkRequests)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(authGoogleLinkRequests.userId, admin!.id));
  expect(
    await repository.consumeGoogleLinkRequest(nonce, admin!.id, sessionId),
  ).toBe(false);
  for (const role of ["anon", "authenticated", "service_role"])
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(sql.raw(`set local role ${role}`));
        await tx.execute(sql`select * from auth_google_link_requests`);
      }),
    ).rejects.toThrow();
});

test("signup hook admits only unlinked Google invitations; editable metadata and public email signup cannot claim them", async () => {
  const email = "invited@dual-auth.test";
  await repository.preprovision({ email, name: "Invited", roles: ["ADMIN"] });
  const runHook = async (providerName: string, address: string) => {
    const event = JSON.stringify({
      user: {
        email: address,
        app_metadata: { provider: providerName },
        user_metadata: { roles: ["ADMIN"], provider: "google" },
      },
    });
    const [row] = await database.db.transaction(async (tx) => {
      return tx.execute<{ result: unknown }>(
        sql`select private_auth.allow_invited_google_signup(${event}::jsonb) as result`,
      );
    });
    return row?.result;
  };
  expect(await runHook("google", " INVITED@dual-auth.test ")).toEqual({});
  for (const [providerName, address] of [
    ["email", email],
    ["google", "unknown@dual-auth.test"],
    ["google", "admin@dual-auth.test"],
    ["github", email],
  ])
    expect(await runHook(providerName!, address!)).toMatchObject({
      error: { http_code: 403 },
    });
  const publicClient = createClient(
    environment.apiUrl,
    environment.publishableKey,
    { auth: { persistSession: false } },
  );
  const signup = await publicClient.auth.signUp({
    email,
    password,
    options: { data: { roles: ["ADMIN"], provider: "google" } },
  });
  expect(signup.data.user).toBeNull();
  expect(signup.error).not.toBeNull();
  const invitation = await database.db
    .select()
    .from(users)
    .where(eq(users.email, email));
  expect(invitation[0]?.authUserId).toBeNull();
  const [grant] = await database.db.execute<{ allowed: boolean }>(
    sql`select has_function_privilege('supabase_auth_admin', 'private_auth.allow_invited_google_signup(jsonb)', 'EXECUTE') and has_schema_privilege('supabase_auth_admin', 'private_auth', 'USAGE') as allowed`,
  );
  expect(grant?.allowed).toBe(true);
  for (const role of ["anon", "authenticated", "service_role"])
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(sql.raw(`set local role ${role}`));
        await tx.execute(
          sql`select private_auth.allow_invited_google_signup('{}'::jsonb)`,
        );
      }),
    ).rejects.toThrow();
});
test("persistent auth limiter survives independent requests and never stores IP or email", async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      withRequestDatabase(
        () =>
          consumeAuthAttempt(
            "192.0.2.44",
            "integration",
            "private@dual-auth.test",
          ),
        undefined,
        environment.databaseUrl,
      ),
    ),
  );
  expect(results.filter(Boolean)).toHaveLength(10);
  const buckets = await database.db.execute<{ key: string; attempts: number }>(
    sql`select key, attempts from auth_attempt_buckets`,
  );
  expect(buckets).toHaveLength(2);
  for (const bucket of buckets) {
    expect(bucket.key).toMatch(/^[a-f0-9]{64}$/u);
    expect(bucket.attempts).toBe(12);
  }
  await expect(
    withRequestDatabase(
      () => consumeAuthAttempt("not-an-ip", "integration"),
      undefined,
      environment.databaseUrl,
    ),
  ).rejects.toThrow();
  const [security] = await database.db.execute<{ enabled: boolean }>(
    sql`select relrowsecurity as enabled from pg_class where oid='auth_attempt_buckets'::regclass`,
  );
  expect(security?.enabled).toBe(true);
  for (const role of ["anon", "authenticated", "service_role"])
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(sql.raw(`set local role ${role}`));
        await tx.execute(sql`select * from auth_attempt_buckets`);
      }),
    ).rejects.toThrow();
});
