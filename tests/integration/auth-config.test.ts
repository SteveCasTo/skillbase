import { describe, expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";

import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

describe("local Supabase Auth configuration", () => {
  test("rejects public password signup while allowing Admin API fixtures", async () => {
    const environment = getTestSupabaseEnvironment();
    const publicClient = createClient(
      environment.apiUrl,
      environment.publishableKey,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const email = `signup-disabled-${crypto.randomUUID()}@auth-config.test`;
    const { data: signup, error: signupError } = await publicClient.auth.signUp(
      {
        email,
        password: "Test-only-password-42!",
      },
    );
    expect(signup.user).toBeNull();
    expect(signupError).not.toBeNull();

    const admin = createClient(environment.apiUrl, environment.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "Test-only-password-42!",
      email_confirm: true,
    });
    expect(error).toBeNull();
    if (!data.user) throw new Error("Admin API fixture was not created");
    expect(data.user.email).toBe(email);
    const { error: deleteError } = await admin.auth.admin.deleteUser(
      data.user.id,
    );
    expect(deleteError).toBeNull();
  });
});
