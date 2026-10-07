import type { InternalUser } from "@/domain/auth/types";
import type { EvaluationRepository } from "@/application/evaluations/evaluation-repository";
import { getCourseEvaluations } from "@/application/evaluations/manage-evaluations";
import type { CourseEvaluationsDto } from "@/domain/evaluations/types";
import { evaluationFailure } from "./http";
import { getEvaluationRepository } from "./service";

export type EvaluationLoadResult =
  | { available: true; data: CourseEvaluationsDto }
  | {
      available: false;
      status: number;
      code: string;
      unavailableReason: string;
    };
export async function loadCourseEvaluations(input: {
  actor: InternalUser;
  courseId: string;
  groupId?: string;
  repository?: EvaluationRepository;
}): Promise<EvaluationLoadResult> {
  try {
    return {
      available: true,
      data: await getCourseEvaluations(
        input.repository ?? getEvaluationRepository(),
        input.actor,
        input.courseId,
        input.groupId,
      ),
    };
  } catch (error) {
    const failure = evaluationFailure(error);
    return {
      available: false,
      status: failure.status,
      code: failure.payload.code,
      unavailableReason: failure.payload.message,
    };
  }
}
