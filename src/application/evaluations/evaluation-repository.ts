import type {
  CourseEvaluationsDto,
  EvaluationCommandResult,
  SaveEvaluationGradeInput,
  SaveEvaluationSchemeInput,
} from "@/domain/evaluations/types";
export interface EvaluationRepository {
  getCourse(
    actorId: string,
    courseId: string,
    groupId?: string,
  ): Promise<CourseEvaluationsDto>;
  saveScheme(
    actorId: string,
    input: SaveEvaluationSchemeInput,
  ): Promise<EvaluationCommandResult>;
  saveGrade(
    actorId: string,
    input: SaveEvaluationGradeInput,
  ): Promise<EvaluationCommandResult>;
}
