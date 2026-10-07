import type { InternalUser } from "@/domain/auth/types";
import {
  EvaluationError,
  evaluationHundredths,
  evaluationId,
  validateEvaluationComponents,
} from "@/domain/evaluations/rules";
import type {
  EvaluationCommand,
  SaveEvaluationGradeInput,
  SaveEvaluationSchemeInput,
} from "@/domain/evaluations/types";
import type { EvaluationRepository } from "./evaluation-repository";
export function requireEvaluationActor(actor: InternalUser): void {
  if (
    actor.status !== "ACTIVE" ||
    !actor.roles.some((r) => r === "ADMIN" || r === "INSTRUCTOR")
  )
    throw new EvaluationError(
      "FORBIDDEN",
      "No tienes autorización para gestionar evaluaciones.",
    );
}
export function validateEvaluationCommand(input: EvaluationCommand): void {
  evaluationId(input.requestKey, "requestKey");
  evaluationId(input.courseId, "courseId");
  if (input.groupId !== undefined) evaluationId(input.groupId, "groupId");
  if (!Number.isSafeInteger(input.schemeRevision) || input.schemeRevision < 0)
    throw new EvaluationError(
      "VALIDATION_FAILED",
      "Recarga la revisión vigente.",
      { schemeRevision: "Revisión no válida." },
    );
}
export function validateSaveScheme(input: SaveEvaluationSchemeInput): void {
  validateEvaluationCommand(input);
  validateEvaluationComponents(input.components);
}
export function validateSaveGrade(input: SaveEvaluationGradeInput): void {
  validateEvaluationCommand(input);
  evaluationId(input.registrationId, "registrationId");
  evaluationId(input.componentId, "componentId");
  evaluationHundredths(input.score, "score");
  if (!Number.isSafeInteger(input.gradeRevision) || input.gradeRevision < 0)
    throw new EvaluationError("VALIDATION_FAILED", "Recarga la nota vigente.", {
      gradeRevision: "Revisión no válida.",
    });
}
export async function getCourseEvaluations(
  repo: EvaluationRepository,
  actor: InternalUser,
  courseId: string,
  groupId?: string,
) {
  requireEvaluationActor(actor);
  return repo.getCourse(
    actor.id,
    evaluationId(courseId, "courseId"),
    groupId === undefined ? undefined : evaluationId(groupId, "groupId"),
  );
}
export async function saveEvaluationScheme(
  repo: EvaluationRepository,
  actor: InternalUser,
  input: SaveEvaluationSchemeInput,
) {
  requireEvaluationActor(actor);
  validateSaveScheme(input);
  return repo.saveScheme(actor.id, input);
}
export async function saveEvaluationGrade(
  repo: EvaluationRepository,
  actor: InternalUser,
  input: SaveEvaluationGradeInput,
) {
  requireEvaluationActor(actor);
  validateSaveGrade(input);
  return repo.saveGrade(actor.id, input);
}
