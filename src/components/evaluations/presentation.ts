import type { EvaluationType } from "@/domain/evaluations/types";

export const evaluationTypeLabels: Record<EvaluationType | "MIXED", string> = {
  THEORY: "Teórica",
  PRACTICAL: "Práctica",
  MIXED: "Mixta",
};

/** Formatting only: the server supplies the authoritative decimal/result. */
export function gradeLabel(value: string): string {
  return value.replace(".", ",");
}

export function evaluationPrefix(instructorRoute: boolean): string {
  return instructorRoute ? "/app/mis-cursos" : "/app/cursos";
}
