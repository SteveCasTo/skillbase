import { afterAll, expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createDatabase } from "@/server/db/client";
import {
  accountHasPassword,
  hasLiveAccountSession,
} from "@/server/auth/password-presence";
import { accountIdentity } from "@/server/auth/identity";
const environment = getTestSupabaseEnvironment();
const database = createDatabase(environment.databaseUrl);
const provider = createClient(environment.apiUrl, environment.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ids: string[] = [];
afterAll(async () => {
  for (const id of ids) await provider.auth.admin.deleteUser(id);
  await database.close();
});
test("credential presence reads only a boolean from Auth, not metadata or email identities", async () => {
  for (const hasPassword of [false, true]) {
    const email = `${hasPassword ? "password" : "no-password"}@password-presence.test`;
    const { data, error } = await provider.auth.admin.createUser({
      email,
      email_confirm: true,
      ...(hasPassword ? { password: "Synthetic-Presence-2026" } : {}),
      user_metadata: { has_password: !hasPassword },
    });
    expect(error).toBeNull();
    ids.push(data.user!.id);
    // Admin createUser generates a random password when omitted. Model a real
    // OAuth-only row explicitly within this isolated provider-boundary fixture.
    if (!hasPassword)
      await database.db.execute(
        sql`update auth.users set encrypted_password = '' where id = ${data.user!.id}::uuid`,
      );
    const user = {
      id: "internal",
      authUserId: data.user!.id,
      email,
      name: "Synthetic",
      status: "ACTIVE" as const,
      roles: ["ADMIN" as const],
    };
    const identity = accountIdentity(data.user!);
    expect(await accountHasPassword(user, identity, database.db)).toBe(
      hasPassword,
    );
    expect(
      await hasLiveAccountSession(
        user,
        identity,
        "00000000-0000-4000-8000-000000000001",
        database.db,
      ),
    ).toBe(false);
    if (hasPassword) {
      const client = createClient(
        environment.apiUrl,
        environment.publishableKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const login = await client.auth.signInWithPassword({
        email,
        password: "Synthetic-Presence-2026",
      });
      expect(login.error).toBeNull();
      const { data: claims } = await client.auth.getClaims();
      const sessionId = claims!.claims.session_id as string;
      expect(
        await hasLiveAccountSession(user, identity, sessionId, database.db),
      ).toBe(true);
      expect((await client.auth.signOut({ scope: "local" })).error).toBeNull();
      expect(
        await hasLiveAccountSession(user, identity, sessionId, database.db),
      ).toBe(false);
    }
    await expect(
      accountHasPassword(
        { ...user, authUserId: "other" },
        identity,
        database.db,
      ),
    ).rejects.toThrow();
    await expect(
      accountHasPassword(
        { ...user, status: "DISABLED" },
        identity,
        database.db,
      ),
    ).rejects.toThrow();
  }
});
