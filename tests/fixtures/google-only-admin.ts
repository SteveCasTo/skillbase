import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { users, userRoles } from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { attachGoogleFixture } from "./oauth-provider";

/** Every attempt owns its identity; failed attempts cannot contaminate retries. */
export async function createGoogleOnlyAdminFixture() {
  const environment = getTestSupabaseEnvironment();
  const provider = createClient(
    environment.apiUrl,
    environment.serviceRoleKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const email = `google-admin-${randomUUID()}@e2e.test`;
  const name = "Legacy Google Admin";
  const { data, error } = await provider.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error("Owned Google ADMIN fixture creation failed");
  const authUserId = data.user.id;
  const database = createDatabase(environment.databaseUrl);
  const cleanup = async () => {
    const owned = createDatabase(environment.databaseUrl);
    try {
      // Retain domain IDs/audit evidence until the isolated stack is destroyed.
      await owned.db
        .update(users)
        .set({ status: "DISABLED" })
        .where(eq(users.authUserId, authUserId));
      const deleted = await provider.auth.admin.deleteUser(authUserId);
      if (deleted.error)
        throw new Error("Owned Google ADMIN fixture cleanup failed");
    } finally {
      await owned.close();
    }
  };
  try {
    const [user] = await database.db
      .insert(users)
      .values({
        email,
        name,
        authUserId,
        authPrimaryProvider: "GOOGLE",
        status: "ACTIVE",
      })
      .returning({ id: users.id });
    if (!user) throw new Error("Owned Google ADMIN internal fixture failed");
    await database.db
      .insert(userRoles)
      .values({ userId: user.id, roleCode: "ADMIN" });
    // Admin API confirms email, but an OAuth-only fixture has no email identity.
    await database.db.execute(
      sql`delete from auth.identities where user_id = ${authUserId}::uuid and provider = 'email'`,
    );
    // GoTrue Admin provisioning otherwise leaves a credential-shaped value.
    await database.db.execute(
      sql`update auth.users set encrypted_password = '' where id = ${authUserId}::uuid`,
    );
    await attachGoogleFixture(authUserId, email);
    return { email, name, authUserId, cleanup };
  } catch (caught) {
    await cleanup();
    throw caught;
  } finally {
    await database.close();
  }
}
