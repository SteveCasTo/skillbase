import type {
  CourseEvaluationsDto,
  EvaluationCommandResult,
  SaveEvaluationGradeInput,
  SaveEvaluationRowInput,
  SaveEvaluationSchemeInput,
} from "@/domain/evaluations/types";
export interface EvaluationRepository {
  saveRow(
    actorId: string,
    input: SaveEvaluationRowInput,
  ): Promise<EvaluationCommandResult>;
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
