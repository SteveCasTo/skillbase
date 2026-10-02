import {
  isGoogleAssociated,
  requireMatchingAccount,
  sessionFromVerifiedClaims,
  type AccountIdentity,
} from "./identity";
import type { InternalUser } from "./types";

/** Claims must come from getClaims after live getUser validation, never decoded cookies. */
export function hasRecentGooglePasswordProof(
  user: InternalUser,
  identity: AccountIdentity,
  claims: unknown,
  now = Date.now(),
): boolean {
  try {
    requireMatchingAccount(user, identity);
    if (
      !isGoogleAssociated(user, identity) ||
      identity.identities.some(
        (entry) => !["google", "email"].includes(entry.provider),
      )
    )
      return false;
    if (sessionFromVerifiedClaims(claims, identity.id).method !== "OAUTH")
      return false;
    const amr = (claims as { amr: unknown[] }).amr;
    return amr.some((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as Record<string, unknown>;
      return (
        value.method === "oauth" &&
        typeof value.timestamp === "number" &&
        Number.isFinite(value.timestamp) &&
        value.timestamp * 1000 <= now &&
        now - value.timestamp * 1000 < 5 * 60 * 1000
      );
    });
  } catch {
    return false;
  }
}
