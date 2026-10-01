import { requireRoles } from "@/application/auth/authorize";
import type { InternalUser } from "@/domain/auth/types";
import {
  InstructorError,
  validateInstructor,
} from "@/domain/instructors/profile";
import type { InstructorRepository } from "./instructor-repository";

export function listInstructors(
  repository: InstructorRepository,
  actor: InternalUser,
) {
  requireRoles(actor, ["ADMIN"]);
  return repository.list();
}
export function getInstructor(
  repository: InstructorRepository,
  actor: InternalUser,
  id: string,
) {
  requireRoles(actor, ["ADMIN"]);
  return repository.get(id);
}
export async function updateInstructor(
  repository: InstructorRepository,
  actor: InternalUser,
  id: string,
  input: Readonly<Record<string, string | undefined>>,
  expected: string,
) {
  requireRoles(actor, actor.id === id ? ["INSTRUCTOR", "ADMIN"] : ["ADMIN"]);
  const previous = await repository.get(id);
  if (!previous) throw new InstructorError("El instructor no existe.");
  const data = validateInstructor({ ...input, email: previous.email });
  const revision = new Date(expected);
  if (!Number.isFinite(revision.getTime()))
    throw new InstructorError("Recarga la página antes de guardar.");
  return repository.update(id, data, actor.id, revision);
}
