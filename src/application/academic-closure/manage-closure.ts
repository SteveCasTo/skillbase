import type { InternalUser } from "@/domain/auth/types";
import {
  ClosureError,
  closureId,
  validateClosureCommand,
  validateReopen,
} from "@/domain/academic-closure/rules";
import type {
  ClosureCommand,
  ReopenGroupInput,
} from "@/domain/academic-closure/types";
import type { ClosureRepository } from "./closure-repository";

export function requireClosureActor(
  actor: InternalUser,
  adminOnly = false,
): void {
  if (
    actor.status !== "ACTIVE" ||
    (!actor.roles.includes("ADMIN") &&
      (adminOnly || !actor.roles.includes("INSTRUCTOR")))
  )
    throw new ClosureError(
      "FORBIDDEN",
      "La cuenta no tiene autorización vigente.",
    );
}
export function getAcademicClosure(
  repository: ClosureRepository,
  actor: InternalUser,
  courseId: string,
  groupId: string,
) {
  requireClosureActor(actor);
  closureId(courseId, "courseId");
  closureId(groupId, "groupId");
  return repository.getGroup(actor.id, courseId, groupId);
}
export function getAcademicClosureVersion(
  repository: ClosureRepository,
  actor: InternalUser,
  courseId: string,
  groupId: string,
  version: number,
) {
  requireClosureActor(actor);
  closureId(courseId, "courseId");
  closureId(groupId, "groupId");
  if (!Number.isSafeInteger(version) || version < 1)
    throw new ClosureError("VALIDATION_FAILED", "Versión no válida.");
  return repository.getVersion(actor.id, courseId, groupId, version);
}
export function closeAcademicGroup(
  repository: ClosureRepository,
  actor: InternalUser,
  input: ClosureCommand,
) {
  requireClosureActor(actor);
  validateClosureCommand(input);
  return repository.close(actor.id, input);
}
export function reopenAcademicGroup(
  repository: ClosureRepository,
  actor: InternalUser,
  input: ReopenGroupInput,
) {
  requireClosureActor(actor, true);
  validateReopen(input);
  return repository.reopen(actor.id, input);
}
