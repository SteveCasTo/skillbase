import { hasRole } from "@/domain/auth/policies";
import type { InternalUser } from "@/domain/auth/types";
import { RegistrationError } from "@/domain/pre-registrations/errors";

/** Server application guard; repository must also check fresh actor state in its transaction. */
export function requireRegistrationAdmin(
  actor: InternalUser | null,
): asserts actor is InternalUser {
  if (!actor || actor.status !== "ACTIVE" || !hasRole(actor, "ADMIN"))
    throw new RegistrationError(
      "FORBIDDEN",
      "Solo administración activa puede gestionar participantes y registros.",
    );
}

/** Applied before constructing the minimal roster DTO, never after fetching PII. */
export function requireInstructorRosterAccess(
  actor: InternalUser | null,
  assignedInstructorId: string | null,
  startsAt: Date,
  now: Date,
): asserts actor is InternalUser {
  if (
    !actor ||
    actor.status !== "ACTIVE" ||
    !hasRole(actor, "INSTRUCTOR") ||
    actor.id !== assignedInstructorId ||
    now < startsAt
  )
    throw new RegistrationError(
      "FORBIDDEN",
      "La lista solo está disponible para el instructor asignado desde el inicio oficial.",
    );
}
