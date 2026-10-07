import type { EvaluationResultDto } from "@/domain/evaluations/types";
import { gradeLabel } from "./presentation";

export function EvaluationResult({ result }: { result: EvaluationResultDto }) {
  return (
    <div
      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
      aria-live="polite"
    >
      {result.status === "PENDING" ? (
        <p className="text-muted-foreground">Pendiente</p>
      ) : (
        <>
          <p className="font-semibold tabular-nums">
            Nota final:{" "}
            {gradeLabel(result.finalGrade ?? result.decisionGrade)}{" "}
          </p>
          <p className="text-muted-foreground">
            {result.passed ? "Aprobado" : "No aprobado"}
          </p>
        </>
      )}
    </div>
  );
}
