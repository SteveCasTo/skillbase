import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AdminCredentialGateway } from "@/application/admin-accounts/repository";
import { getPublicAuthEnvironment } from "@/server/environment";

export function adminCredentialGateway(
  client: SupabaseClient,
): AdminCredentialGateway {
  const remove = async (id: string) => {
    const { error } = await client.auth.admin.deleteUser(id);
    // A generic 404/network/provider error never proves successful deletion.
    if (error && error.code !== "user_not_found")
      throw new Error("Auth deletion unavailable");
  };
  return {
    async createConfirmedUser(email, password) {
      const { data, error } = await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      return error ? null : (data.user?.id ?? null);
    },
    removeCreatedUser: remove,
    deleteUser: remove,
  };
}
export function getAdminCredentialGateway(): AdminCredentialGateway {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("Account provisioning unavailable");
  return adminCredentialGateway(
    createClient(getPublicAuthEnvironment().supabaseUrl, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  );
}
