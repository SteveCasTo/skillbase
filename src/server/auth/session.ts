import { AuthorizationError } from "@/domain/auth/errors";
import { sessionFromVerifiedClaims } from "@/domain/auth/identity";
import type { RequestSupabaseClient } from "./supabase";

export async function loadVerifiedAuthSession(
  supabase: RequestSupabaseClient,
  authUserId: string,
) {
  // getClaims verifies signatures (JWKS or Auth-server validation for symmetric
  // keys). Callers also use getUser for live account/session validation first.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data)
    throw new AuthorizationError(
      "UNAUTHENTICATED",
      "Authentication method is not verified",
    );
  return sessionFromVerifiedClaims(data.claims, authUserId);
}
