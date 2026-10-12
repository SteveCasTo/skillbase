import { hasRole } from "@/domain/auth/policies";
import type { InternalUser } from "@/domain/auth/types";

/** Resolve the operational entry point without changing explicit Auth destinations. */
export function privateEntryPath(user: InternalUser): string | null {
  if (hasRole(user, "ADMIN")) return "/app/cursos";
  if (hasRole(user, "INSTRUCTOR")) return "/app/mis-cursos";
  return null;
}
