import type {
  CourseEvaluationsDto,
  SaveEvaluationGradeInput,
  SaveEvaluationSchemeInput,
} from "@/domain/evaluations/types";

/** Presentation boundary; transport adaptation belongs in the connected page. */
export type EvaluationSaveResult =
  | { ok: true; value: CourseEvaluationsDto }
  | {
      ok: false;
      message: string;
      issues: Readonly<Record<string, string>>;
      code?: string;
      currentData?: CourseEvaluationsDto;
    };

export type SaveScheme = (
  input: SaveEvaluationSchemeInput,
) => Promise<EvaluationSaveResult>;
export type SaveGrade = (
  input: SaveEvaluationGradeInput,
) => Promise<EvaluationSaveResult>;
