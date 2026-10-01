import { createClient } from "@supabase/supabase-js";
import {
  provisionPasswordInstructor,
  type PasswordProvisionInput,
} from "@/application/auth/provision-password-user";
import { getPublicAuthEnvironment } from "@/server/environment";
import { getDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";

/** No public endpoint. Call only after getUser() in the instructor application flow. */
export async function createInstructorAccount(
  actorAuthUserId: string,
  input: PasswordProvisionInput,
) {
  const environment = getPublicAuthEnvironment();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("Account provisioning is unavailable");
  const privileged = createClient(environment.supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return provisionPasswordInstructor(
    new DrizzleAuthUserRepository(getDatabase()),
    {
      async createConfirmedUser(email, password) {
        const { data, error } = await privileged.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        return error ? null : (data.user?.id ?? null);
      },
      async removeCreatedUser(id) {
        await privileged.auth.admin.deleteUser(id);
      },
    },
    actorAuthUserId,
    input,
  );
}
