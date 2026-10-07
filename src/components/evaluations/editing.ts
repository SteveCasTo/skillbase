import {
  evaluationHundredths,
  normalizeEvaluationDecimal,
} from "@/domain/evaluations/rules";
import type {
  EvaluationGradeDto,
  SaveEvaluationRowInput,
} from "@/domain/evaluations/types";

export function weightTotal(weights: readonly string[]): number | null {
  try {
    return weights.reduce(
      (sum, weight) => sum + evaluationHundredths(weight, "weight"),
      0,
    );
  } catch {
    return null;
  }
}

/** Allow the empty/decimal-separator intermediate states without admitting excess precision or budget. */
export function acceptsWeightDraft(value: string, maximum: number): boolean {
  if (value === "") return true;
  if (!/^(?:0|[1-9]\d{0,2})(?:[.,]\d{0,2})?$/u.test(value)) return false;
  const complete = value.replace(/[.,]$/u, "");
  try {
    return evaluationHundredths(complete, "weight") <= maximum;
  } catch {
    return false;
  }
}

export interface GradeDraft {
  componentId: string;
  score: string;
  baseline: string | null;
  revision: number;
}

export function gradeDrafts(
  componentIds: readonly string[],
  grades: readonly EvaluationGradeDto[],
): GradeDraft[] {
  return componentIds.map((componentId) => {
    const grade = grades.find((grade) => grade.componentId === componentId);
    return {
      componentId,
      score: grade?.score ?? "",
      baseline: grade?.score ?? null,
      revision: grade?.revision ?? 0,
    };
  });
}

/** Validate only user edits; untouched missing grades remain pending, never become zero. */
export function changedGrades(drafts: readonly GradeDraft[]): {
  grades: SaveEvaluationRowInput["grades"];
  errors: Readonly<Record<string, string>>;
} {
  const grades: SaveEvaluationRowInput["grades"][number][] = [];
  const errors: Record<string, string> = {};
  for (const draft of drafts) {
    if (draft.baseline === null && draft.score.trim() === "") continue;
    if (draft.score === draft.baseline) continue;
    if (!draft.score.trim()) {
      errors[draft.componentId] =
        "No puedes borrar una nota registrada. Introduce un valor de 0 a 100.";
      continue;
    }
    try {
      const score = evaluationHundredths(draft.score, "score");
      if (
        draft.baseline !== null &&
        score === evaluationHundredths(draft.baseline, "score")
      )
        continue;
      grades.push({
        componentId: draft.componentId,
        gradeRevision: draft.revision,
        score: normalizeEvaluationDecimal(draft.score, "score"),
      });
    } catch {
      errors[draft.componentId] =
        "Usa un valor de 0 a 100, con hasta dos decimales.";
    }
  }
  return { grades, errors };
}
