import type { AuthRole, InternalUser } from "@/domain/auth/types";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hasRole(user: InternalUser, role: AuthRole): boolean {
  return user.roles.includes(role);
}

export function hasAnyRole(
  user: InternalUser,
  requiredRoles: readonly AuthRole[],
): boolean {
  return requiredRoles.some((role) => hasRole(user, role));
}

export function canAccessPrivateApp(user: InternalUser): boolean {
  return user.status === "ACTIVE" && user.roles.length > 0;
}
