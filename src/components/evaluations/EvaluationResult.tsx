import type { EvaluationResultDto } from "@/domain/evaluations/types";
import { gradeLabel } from "./presentation";

export function EvaluationResult({ result }: { result: EvaluationResultDto }) {
  return (
    <div className="flex flex-col gap-1 text-sm" aria-live="polite">
      {result.status === "PENDING" ? (
        <>
          <p className="font-semibold">Pendiente · evaluación incompleta</p>
          <p className="text-muted-foreground">
            Equivale a {gradeLabel(result.decisionGrade)} para la decisión
            académica hasta completar las notas.
          </p>
        </>
      ) : (
        <>
          <p className="font-semibold tabular-nums">
            Nota final: {gradeLabel(result.finalGrade ?? result.decisionGrade)}{" "}
            / 100
          </p>
          <p className="text-muted-foreground">
            {result.passed ? "Aprobado" : "No aprobado"}
          </p>
        </>
      )}
    </div>
  );
}
