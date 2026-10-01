import type { User } from "@supabase/supabase-js";
import type { AccountIdentity } from "@/domain/auth/identity";

export function accountIdentity(user: User): AccountIdentity {
  return {
    id: user.id,
    email: user.email ?? "",
    verified: Boolean(user.email_confirmed_at),
    identities: (user.identities ?? []).map((identity) => ({
      id: identity.id,
      provider: identity.provider,
      email:
        typeof identity.identity_data?.email === "string"
          ? identity.identity_data.email
          : "",
      verified:
        identity.provider === "email"
          ? Boolean(user.email_confirmed_at)
          : identity.identity_data?.email_verified === true,
    })),
  };
}
