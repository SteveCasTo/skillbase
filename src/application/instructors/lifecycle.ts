import { requireRoles } from "@/application/auth/authorize";
import type { InternalUser } from "@/domain/auth/types";
import { InstructorError } from "@/domain/instructors/profile";
import type { InstructorLifecycle } from "@/domain/instructors/lifecycle";

export interface InstructorLifecycleRepository {
  inspect(id: string): Promise<InstructorLifecycle>;
  setActive(
    id: string,
    actorId: string,
    active: boolean,
    expected: Date,
  ): Promise<void>;
  beginDeletion(id: string, actorId: string, expected: Date): Promise<string>;
  completeDeletion(
    id: string,
    actorId: string,
    authUserId: string,
  ): Promise<void>;
}

export interface InstructorCredentialRemoval {
  remove(authUserId: string): Promise<void>;
}

export async function mutateInstructorLifecycle(
  repository: InstructorLifecycleRepository,
  credentials: InstructorCredentialRemoval,
  actor: InternalUser,
  id: string,
  action: string,
  revision: string,
): Promise<void> {
  requireRoles(actor, ["ADMIN"]);
  const expected = new Date(revision);
  if (!Number.isFinite(expected.getTime()))
    throw new InstructorError("Recarga la página antes de continuar.");
  if (action === "activate" || action === "deactivate") {
    await repository.setActive(id, actor.id, action === "activate", expected);
    return;
  }
  if (action !== "delete") throw new InstructorError("La acción no es válida.");
  const authUserId = await repository.beginDeletion(id, actor.id, expected);
  try {
    await credentials.remove(authUserId);
    await repository.completeDeletion(id, actor.id, authUserId);
  } catch {
    // Never reactivate on failure: the provider might already have removed the identity.
    throw new InstructorError(
      "No se completó la eliminación. La cuenta permanece bloqueada; reintenta eliminarla para completar el proceso.",
    );
  }
}
