import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminCredentialGateway } from "@/application/admin-accounts/repository";
import {
  createConfirmedAccount,
  getAccountCredentialClient,
  removeCreatedAccount,
} from "@/server/auth/account-credentials";

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
    createConfirmedUser: (email, password) =>
      createConfirmedAccount(client, email, password),
    removeCreatedUser: (id) => removeCreatedAccount(client, id),
    deleteUser: remove,
  };
}
export function getAdminCredentialGateway(): AdminCredentialGateway {
  return adminCredentialGateway(getAccountCredentialClient());
}
