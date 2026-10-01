import { requireRoles } from "@/application/auth/authorize";
import { AuthorizationError } from "@/domain/auth/errors";
import type { InternalUser } from "@/domain/auth/types";
import {
  validateInterestMutation,
  validateRegisterInterest,
  UUID,
  InterestError,
} from "@/domain/interests/rules";
import type { InterestStatus } from "@/domain/interests/types";
import type { InterestRepository } from "./interest-repository";
export function requireInterestAdmin(actor: InternalUser): void {
  if (actor.status !== "ACTIVE")
    throw new AuthorizationError(
      "DISABLED",
      "Only active administrators can manage interests",
    );
  requireRoles(actor, ["ADMIN"]);
}
function courseIdValid(id: string) {
  if (!UUID.test(id))
    throw new InterestError("COURSE_NOT_FOUND", 404, "Curso no encontrado.");
}
export async function registerInterest(
  repo: InterestRepository,
  slug: string,
  raw: unknown,
) {
  await repo.register(slug, validateRegisterInterest(raw));
}
export async function listInterestSummary(
  repo: InterestRepository,
  actor: InternalUser,
) {
  requireInterestAdmin(actor);
  return repo.summary();
}
export async function getInterestCourse(
  repo: InterestRepository,
  actor: InternalUser,
  courseId: string,
  status?: InterestStatus,
) {
  requireInterestAdmin(actor);
  courseIdValid(courseId);
  if (status !== undefined && status !== "ACTIVE" && status !== "CANCELLED")
    throw new InterestError(
      "INVALID_REQUEST",
      400,
      "La solicitud no es válida.",
    );
  return repo.course(courseId, status);
}
export async function mutateInterest(
  repo: InterestRepository,
  actor: InternalUser,
  courseId: string,
  raw: unknown,
) {
  requireInterestAdmin(actor);
  courseIdValid(courseId);
  return repo.mutate(courseId, validateInterestMutation(raw), actor.id);
}
