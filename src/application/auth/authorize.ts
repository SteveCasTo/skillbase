import { AuthorizationError } from "@/domain/auth/errors";
import { canAccessPrivateApp, hasAnyRole } from "@/domain/auth/policies";
import type { AuthRole, InternalUser } from "@/domain/auth/types";

import type { AuthUserRepository } from "./user-repository";

export async function resolveActiveUser(
  repository: AuthUserRepository,
  authUserId: string,
): Promise<InternalUser> {
  const user = await repository.findByAuthUserId(authUserId);
  if (!user)
    throw new AuthorizationError("NOT_INVITED", "Identity is not provisioned");
  if (user.status === "DISABLED")
    throw new AuthorizationError("DISABLED", "User is disabled");
  if (!canAccessPrivateApp(user))
    throw new AuthorizationError("NO_ROLES", "User has no active permissions");
  return user;
}

export function requireRoles(
  user: InternalUser,
  roles: readonly AuthRole[],
): void {
  if (!hasAnyRole(user, roles))
    throw new AuthorizationError("FORBIDDEN", "Role is not authorized");
}
