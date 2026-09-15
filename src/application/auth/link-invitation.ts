import { AuthorizationError } from "@/domain/auth/errors";
import type { InternalUser, VerifiedIdentity } from "@/domain/auth/types";

import type { AuthUserRepository } from "./user-repository";

export async function linkAuthenticatedInvitation(
  repository: AuthUserRepository,
  identity: VerifiedIdentity,
): Promise<InternalUser> {
  if (!identity.emailVerified)
    throw new AuthorizationError("EMAIL_UNVERIFIED", "Email is not verified");
  return repository.linkVerifiedInvitation(identity);
}
