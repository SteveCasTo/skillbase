import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicAuthEnvironment } from "@/server/environment";

/** Log only structural diagnostics, never messages, SQL, bodies or credentials. */
export function logAccountCreationFailure(
  operation: string,
  error: unknown,
): void {
  let cause = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!(cause instanceof Error) || !cause.cause) break;
    cause = cause.cause;
  }
  const record = cause && typeof cause === "object" ? cause : {};
  const code =
    "code" in record &&
    typeof record.code === "string" &&
    /^[a-zA-Z0-9_]{1,64}$/u.test(record.code)
      ? record.code
      : undefined;
  const status =
    "status" in record && typeof record.status === "number"
      ? record.status
      : undefined;
  console.error("account_creation_failure", {
    operation,
    ...(code ? { code } : {}),
    ...(status ? { status } : {}),
  });
}

export function getAccountCredentialClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    logAccountCreationFailure("configuration", {
      code: "MISSING_SERVICE_ROLE_KEY",
    });
    throw new Error("Account provisioning unavailable");
  }
  return createClient(getPublicAuthEnvironment().supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function createConfirmedAccount(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<string | null> {
  try {
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) logAccountCreationFailure("auth_create", error);
    return error ? null : (data.user?.id ?? null);
  } catch (error) {
    logAccountCreationFailure("auth_create", error);
    throw error;
  }
}

export async function removeCreatedAccount(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  try {
    const { error } = await client.auth.admin.deleteUser(id);
    if (error && error.code !== "user_not_found") throw error;
  } catch (error) {
    logAccountCreationFailure("auth_compensation", error);
    throw new Error("Auth deletion unavailable");
  }
}
