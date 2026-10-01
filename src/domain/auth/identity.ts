import { AuthorizationError } from "./errors";
import { normalizeEmail, canAccessPrivateApp } from "./policies";
import type { InternalUser } from "./types";

export interface ProviderIdentity {
  readonly id: string;
  readonly provider: string;
  readonly email: string;
  readonly verified: boolean;
}

export interface AccountIdentity {
  readonly id: string;
  readonly email: string;
  readonly verified: boolean;
  readonly identities: readonly ProviderIdentity[];
}

export interface VerifiedAuthSession {
  readonly id: string;
  readonly method: "PASSWORD" | "EMAIL_CONFIRMATION" | "OAUTH";
}

/** Accept only claims already verified by the configured Auth provider. */
export function sessionFromVerifiedClaims(
  claims: unknown,
  authUserId: string,
): VerifiedAuthSession {
  const invalid = () =>
    new AuthorizationError(
      "UNAUTHENTICATED",
      "Authentication method is not verified",
    );
  if (!claims || typeof claims !== "object") throw invalid();
  const value = claims as Record<string, unknown>;
  if (
    value.sub !== authUserId ||
    typeof value.session_id !== "string" ||
    !value.session_id ||
    value.role !== "authenticated" ||
    value.is_anonymous !== false ||
    !Array.isArray(value.amr)
  )
    throw invalid();
  const ignored = new Set([
    "token_refresh",
    "totp",
    "mfa/totp",
    "mfa/phone",
    "mfa/webauthn",
    "mfa/recovery_code",
  ]);
  const entries: { method: string; timestamp: number }[] = [];
  for (const entry of value.amr as unknown[]) {
    if (typeof entry === "string") {
      if (!ignored.has(entry)) entries.push({ method: entry, timestamp: 0 });
    } else if (
      entry &&
      typeof entry === "object" &&
      "method" in entry &&
      "timestamp" in entry &&
      typeof entry.method === "string" &&
      typeof entry.timestamp === "number" &&
      Number.isFinite(entry.timestamp) &&
      entry.timestamp > 0
    ) {
      if (!ignored.has(entry.method))
        entries.push({ method: entry.method, timestamp: entry.timestamp });
    } else throw invalid();
  }
  const latest = Math.max(...entries.map((entry) => entry.timestamp));
  const methods = new Set(
    entries
      .filter((entry) => entry.timestamp === latest)
      .map((entry) => entry.method),
  );
  if (methods.size !== 1) throw invalid();
  const method = [...methods][0];
  if (method === "password")
    return { id: value.session_id, method: "PASSWORD" };
  if (method === "oauth") return { id: value.session_id, method: "OAUTH" };
  if (["recovery", "otp", "magiclink", "invite"].includes(method ?? ""))
    return { id: value.session_id, method: "EMAIL_CONFIRMATION" };
  throw invalid();
}

export function isGoogleAssociated(
  user: InternalUser,
  identity: AccountIdentity,
): boolean {
  const google = identity.identities.filter(
    (entry) => entry.provider === "google",
  );
  return (
    google.length === 1 &&
    google[0]!.verified &&
    normalizeEmail(google[0]!.email) === normalizeEmail(user.email) &&
    (google[0]!.id === user.approvedGoogleIdentityId ||
      (user.authPrimaryProvider === "GOOGLE" &&
        identity.identities.every((entry) => entry.provider === "google")))
  );
}

export function requireMatchingAccount(
  user: InternalUser,
  identity: AccountIdentity,
): void {
  if (!canAccessPrivateApp(user))
    throw new AuthorizationError("FORBIDDEN", "Account is not active");
  if (!identity.verified)
    throw new AuthorizationError(
      "EMAIL_UNVERIFIED",
      "Verified email is required",
    );
  if (
    user.authUserId !== identity.id ||
    normalizeEmail(user.email) !== normalizeEmail(identity.email)
  )
    throw new AuthorizationError(
      "IDENTITY_CONFLICT",
      "Account identity does not match",
    );
}

export function requireApprovedProviders(
  user: InternalUser,
  identity: AccountIdentity,
  session: VerifiedAuthSession,
): void {
  requireMatchingAccount(user, identity);
  // Identities do not prove the method used by the current session. Native
  // linking must not disable password/email ownership or approve OAuth access.
  if (session.method === "PASSWORD" || session.method === "EMAIL_CONFIRMATION")
    return;
  const google = identity.identities.filter(
    (entry) => entry.provider === "google",
  );
  if (
    identity.identities.some(
      (entry) => entry.provider !== "email" && entry.provider !== "google",
    )
  )
    throw new AuthorizationError("FORBIDDEN", "Unsupported provider");
  if (
    google.length !== 1 ||
    google.some(
      (entry) =>
        !entry.verified ||
        normalizeEmail(entry.email) !== normalizeEmail(user.email),
    )
  )
    throw new AuthorizationError(
      "IDENTITY_CONFLICT",
      "Google identity does not match",
    );
  // Supabase automatically links matching emails. That is not application consent.
  if (!isGoogleAssociated(user, identity))
    throw new AuthorizationError(
      "IDENTITY_CONFLICT",
      "Explicit Google association is required",
    );
}

export function requirePassword(password: string, confirmation?: string): void {
  if (
    password.length < 12 ||
    password.length > 128 ||
    (confirmation !== undefined && password !== confirmation)
  )
    throw new Error(
      "La contraseña debe tener entre 12 y 128 caracteres y coincidir con su confirmación.",
    );
}
