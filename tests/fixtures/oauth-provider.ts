import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
const environment = getTestSupabaseEnvironment();

/** Provider-boundary fixture only: GoTrue v2.196's PKCE flow-state contract.
 * No JWT is forged/decoded and no live Google UI is called. GoTrue exchanges
 * the fixture code and signs a real OAuth-method session in the isolated stack.
 */
export function oauthFixtureClient() {
  const storage = new Map<string, string>();
  const storageKey = "isolated-oauth-fixture";
  const flowId = "isolatedFixtureFlow";
  const client = createClient(environment.apiUrl, environment.publishableKey, {
    auth: {
      storageKey,
      flowType: "pkce",
      autoRefreshToken: false,
      persistSession: true,
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
        removeItem: (key) => {
          storage.delete(key);
        },
      },
    },
  });
  return {
    client,
    flowId,
    setVerifier: (verifier: string) => {
      storage.set(`${storageKey}-code-verifier`, JSON.stringify(verifier));
      storage.set(
        `${storageKey}-flow-${flowId}-code-verifier`,
        JSON.stringify(verifier),
      );
      storage.set(
        `${storageKey}-flows-code-verifier`,
        JSON.stringify([flowId]),
      );
    },
  };
}

export async function attachGoogleFixture(
  authUserId: string,
  email: string,
  subject = `isolated-google-${randomUUID()}`,
): Promise<string> {
  const database = createDatabase(environment.databaseUrl);
  try {
    await database.db
      .execute(sql`insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
      values (${randomUUID()}::uuid, ${authUserId}::uuid, ${subject}, 'google', ${JSON.stringify({ sub: subject, email, email_verified: true })}::jsonb, now(), now(), now())`);
    return subject;
  } finally {
    await database.close();
  }
}

export async function prepareOAuthFixtureCode(
  authUserId: string,
  verifier: string,
): Promise<string> {
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return prepareProviderCodeFixture(authUserId, challenge, "oauth");
}

export async function prepareProviderCodeFixture(
  authUserId: string,
  challenge: string,
  method: "oauth" | "recovery",
): Promise<string> {
  const database = createDatabase(environment.databaseUrl);
  const code = randomUUID();
  try {
    await database.db
      .execute(sql`insert into auth.flow_state (id, user_id, auth_code, authentication_method, code_challenge, code_challenge_method, provider_type, provider_access_token, provider_refresh_token, auth_code_issued_at, created_at, updated_at, email_optional)
      values (${randomUUID()}::uuid, ${authUserId}::uuid, ${code}, ${method}, ${challenge}, 's256', ${method === "oauth" ? "google" : "email"}, '', '', now(), now(), now(), false)`);
    return code;
  } finally {
    await database.close();
  }
}

/** Complete the flow state actually created by authenticated linkIdentity. */
export async function completeLinkProviderFixture(
  providerRedirect: string,
  authUserId: string,
): Promise<string> {
  const state = new URL(providerRedirect).searchParams.get("state");
  if (!state || !/^[a-f0-9-]{36}$/iu.test(state))
    throw new Error("Fixture provider state is unavailable");
  const database = createDatabase(environment.databaseUrl);
  try {
    const rows = await database.db.execute<{
      auth_code: string;
    }>(sql`update auth.flow_state set user_id = ${authUserId}::uuid, auth_code_issued_at = now(), updated_at = now()
      where id = ${state}::uuid and provider_type = 'google' and (linking_target_id = ${authUserId}::uuid or linking_target_id is null) and user_id is null
      returning auth_code`);
    if (!rows[0]?.auth_code)
      throw new Error("Fixture linking flow is unavailable");
    return rows[0].auth_code;
  } finally {
    await database.close();
  }
}
