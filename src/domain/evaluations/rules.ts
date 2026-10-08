import type {
  EvaluationComponentInput,
  EvaluationResultDto,
  EvaluationType,
} from "./types";

export class EvaluationError extends Error {
  constructor(
    public readonly code:
      | "VALIDATION_FAILED"
      | "GROUP_CLOSED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "NOT_ENROLLED"
      | "SCHEME_FROZEN"
      | "CONCURRENT_UPDATE"
      | "IDEMPOTENCY_CONFLICT",
    message: string,
    public readonly issues: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "EvaluationError";
  }
}
export function evaluationId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(value)
  )
    throw new EvaluationError("VALIDATION_FAILED", "Identificador no válido.", {
      [field]: "Identificador no válido.",
    });
  return value.toLowerCase();
}
/** Integer hundredths: parsing never multiplies a floating decimal. */
export function evaluationHundredths(value: unknown, field: string): number {
  value = normalizeEvaluationDecimal(value, field);
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/u.test(value)
  )
    throw new EvaluationError(
      "VALIDATION_FAILED",
      "Introduce un decimal de 0 a 100 con hasta dos decimales.",
      { [field]: "Usa un valor de 0 a 100, con hasta dos decimales." },
    );
  const [whole, fraction = ""] = value.split(".");
  const scaled = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (scaled > 10000)
    throw new EvaluationError(
      "VALIDATION_FAILED",
      "El valor debe estar entre 0 y 100.",
      { [field]: "El máximo es 100." },
    );
  return scaled;
}
/** Bolivia UI accepts a comma or a dot; neither grouping nor exponent notation is accepted. */
export function normalizeEvaluationDecimal(
  value: unknown,
  field: string,
): string {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,2})(?:[.,]\d{1,2})?$/u.test(value.trim())
  )
    throw new EvaluationError(
      "VALIDATION_FAILED",
      "Introduce un decimal de 0 a 100 con hasta dos decimales.",
      { [field]: "Usa un valor de 0 a 100, con hasta dos decimales." },
    );
  return value.trim().replace(",", ".");
}
export function evaluationDecimal(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10000)
    throw new Error("Invalid evaluation hundredths");
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}
export function validateEvaluationComponents(
  components: readonly EvaluationComponentInput[],
): void {
  if (
    !Array.isArray(components) ||
    components.length < 1 ||
    components.length > 100
  )
    throw new EvaluationError(
      "VALIDATION_FAILED",
      "Define entre 1 y 100 componentes.",
      { components: "Define los componentes de evaluación." },
    );
  const ids = new Set<string>();
  let total = 0;
  components.forEach((component, index) => {
    const id = evaluationId(component.id, `components.${index}.id`);
    if (ids.has(id))
      throw new EvaluationError(
        "VALIDATION_FAILED",
        "Los componentes están duplicados.",
      );
    ids.add(id);
    if (
      typeof component.name !== "string" ||
      component.name.trim().length < 1 ||
      component.name.trim().length > 100 ||
      /\p{Cc}/u.test(component.name)
    )
      throw new EvaluationError(
        "VALIDATION_FAILED",
        "Nombre de componente no válido.",
        {
          [`components.${index}.name`]:
            "Introduce un nombre de 1 a 100 caracteres.",
        },
      );
    if (component.type !== "THEORY" && component.type !== "PRACTICAL")
      throw new EvaluationError(
        "VALIDATION_FAILED",
        "Tipo de componente no válido.",
        { [`components.${index}.type`]: "Selecciona teoría o práctica." },
      );
    total += evaluationHundredths(
      component.weight,
      `components.${index}.weight`,
    );
  });
  if (total !== 10000)
    throw new EvaluationError(
      "VALIDATION_FAILED",
      "Los pesos deben sumar exactamente 100 %.",
      { components: "La suma de pesos debe ser exactamente 100 %." },
    );
}
export function evaluationModality(
  types: readonly EvaluationType[],
): EvaluationType | "MIXED" | null {
  return types.length === 0
    ? null
    : new Set(types).size === 1
      ? types[0]!
      : "MIXED";
}
export function evaluationResult(
  components: readonly { id: string; weightHundredths: number }[],
  grades: readonly { componentId: string; scoreHundredths: number }[],
  minimumGrade: number,
): EvaluationResultDto {
  const missingComponentIds = components
    .filter((c) => !grades.some((g) => g.componentId === c.id))
    .map((c) => c.id);
  if (!components.length || missingComponentIds.length)
    return {
      status: "PENDING",
      finalGrade: null,
      decisionGrade: "0.00",
      passed: false,
      missingComponentIds,
    };
  // Products and sum are bounded integers; round half-up only once, after the exact sum.
  const numerator = components.reduce(
    (sum, c) =>
      sum +
      grades.find((g) => g.componentId === c.id)!.scoreHundredths *
        c.weightHundredths,
    0,
  );
  const finalHundredths = Math.floor((numerator + 5000) / 10000);
  const finalGrade = evaluationDecimal(finalHundredths);
  return {
    status: "COMPLETE",
    finalGrade,
    decisionGrade: finalGrade,
    passed: finalHundredths >= minimumGrade * 100,
    missingComponentIds: [],
  };
}
