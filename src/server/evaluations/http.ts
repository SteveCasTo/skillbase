import type { InternalUser } from "@/domain/auth/types";
import type { EvaluationRepository } from "@/application/evaluations/evaluation-repository";
import {
  requireEvaluationActor,
  saveEvaluationGrade,
  saveEvaluationRow,
  saveEvaluationScheme,
} from "@/application/evaluations/manage-evaluations";
import { EvaluationError } from "@/domain/evaluations/rules";
import type {
  EvaluationCommandResult,
  EvaluationComponentInput,
  SaveEvaluationRowInput,
} from "@/domain/evaluations/types";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { readInterestRequest } from "@/server/interests/request";
import { InterestError } from "@/domain/interests/rules";

export type EvaluationOperation = "scheme" | "grade" | "row";
export type EvaluationHttpPayload =
  | { ok: true; value: EvaluationCommandResult; message: string }
  | {
      ok: false;
      code: string;
      message: string;
      issues: Readonly<Record<string, string>>;
    };
export const evaluationHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function evaluationJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...evaluationHeaders, "Content-Type": "application/json" },
  });
}
export function evaluationFailure(error: unknown): {
  status: number;
  payload: Extract<EvaluationHttpPayload, { ok: false }>;
} {
  if (error instanceof EvaluationError)
    return {
      status:
        error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND"
            ? 404
            : [
                  "CONCURRENT_UPDATE",
                  "IDEMPOTENCY_CONFLICT",
                  "SCHEME_FROZEN",
                ].includes(error.code)
              ? 409
              : 422,
      payload: {
        ok: false,
        code: error.code,
        message: error.message,
        issues: error.issues,
      },
    };
  if (error instanceof InterestError)
    return {
      status: error.status,
      payload: {
        ok: false,
        code: error.code,
        message: error.message,
        issues: {},
      },
    };
  return {
    status: 503,
    payload: {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message:
        "No se pudo confirmar el guardado. Conserva los datos y reintenta la misma solicitud.",
      issues: {},
    },
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new EvaluationError(
      "VALIDATION_FAILED",
      "La solicitud no es válida.",
    );
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new EvaluationError(
      "VALIDATION_FAILED",
      "Introduce un valor de texto válido.",
      { [field]: "Valor no válido." },
    );
  return value;
}
function revision(value: unknown, field: string): number {
  if (typeof value === "string" && /^\d+$/u.test(value)) value = Number(value);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new EvaluationError(
      "VALIDATION_FAILED",
      "Recarga la revisión vigente.",
      { [field]: "Revisión no válida." },
    );
  return value;
}
function allowFields(
  raw: Record<string, unknown>,
  fields: readonly string[],
): void {
  if (Object.keys(raw).some((field) => !fields.includes(field)))
    throw new EvaluationError(
      "VALIDATION_FAILED",
      "La solicitud contiene campos no admitidos.",
    );
}
function componentList(value: unknown): EvaluationComponentInput[] {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new EvaluationError(
        "VALIDATION_FAILED",
        "La lista de componentes no es válida.",
      );
    }
  }
  if (!Array.isArray(value))
    throw new EvaluationError(
      "VALIDATION_FAILED",
      "La lista de componentes no es válida.",
    );
  return (value as unknown[]).map((item, index) => {
    const row = object(item);
    allowFields(row, ["id", "name", "type", "weight"]);
    const type = text(row.type, `components.${index}.type`);
    if (type !== "THEORY" && type !== "PRACTICAL")
      throw new EvaluationError(
        "VALIDATION_FAILED",
        "Tipo de componente no válido.",
      );
    return {
      id: text(row.id, `components.${index}.id`),
      name: text(row.name, `components.${index}.name`),
      type,
      weight: text(row.weight, `components.${index}.weight`),
    };
  });
}
function gradeList(value: unknown): SaveEvaluationRowInput["grades"] {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new EvaluationError(
        "VALIDATION_FAILED",
        "La lista de notas no es válida.",
      );
    }
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    throw new EvaluationError(
      "VALIDATION_FAILED",
      "Indica entre 1 y 100 notas modificadas.",
    );
  return (value as unknown[]).map((item, index) => {
    const row = object(item);
    allowFields(row, ["componentId", "gradeRevision", "score"]);
    return {
      componentId: text(row.componentId, `grades.${index}.componentId`),
      gradeRevision: revision(
        row.gradeRevision,
        `grades.${index}.gradeRevision`,
      ),
      score: text(row.score, `grades.${index}.score`),
    };
  });
}
export async function handleEvaluationPost(input: {
  request: Request;
  actor: InternalUser;
  repository: EvaluationRepository;
  siteUrl: URL;
  operation: EvaluationOperation;
  courseId: string;
  groupId?: string;
}): Promise<{ status: number; payload: EvaluationHttpPayload }> {
  try {
    requireEvaluationActor(input.actor);
    if (!requestHasExpectedOrigin(input.request, input.siteUrl))
      return {
        status: 403,
        payload: {
          ok: false,
          code: "INVALID_ORIGIN",
          message: "Recarga y reintenta desde el formulario.",
          issues: {},
        },
      };
    const raw = object(await readInterestRequest(input.request, 65536));
    // Existing group POST routes accept the row payload without changing legacy grade forms.
    const operation =
      input.operation === "grade" && raw.grades !== undefined
        ? "row"
        : input.operation;
    allowFields(raw, [
      "requestKey",
      "courseId",
      "groupId",
      "schemeRevision",
      ...(operation === "scheme"
        ? ["components"]
        : operation === "row"
          ? ["registrationId", "grades"]
          : ["registrationId", "componentId", "gradeRevision", "score"]),
    ]);
    if (
      (raw.courseId !== undefined && raw.courseId !== input.courseId) ||
      (raw.groupId !== undefined && raw.groupId !== input.groupId)
    )
      throw new EvaluationError(
        "VALIDATION_FAILED",
        "La solicitud no corresponde a esta ruta.",
      );
    const command = {
      requestKey: text(raw.requestKey, "requestKey"),
      courseId: input.courseId,
      ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
      schemeRevision: revision(raw.schemeRevision, "schemeRevision"),
    };
    const value =
      operation === "scheme"
        ? await saveEvaluationScheme(input.repository, input.actor, {
            ...command,
            components: componentList(raw.components),
          })
        : operation === "row"
          ? await saveEvaluationRow(input.repository, input.actor, {
              ...command,
              registrationId: text(raw.registrationId, "registrationId"),
              grades: gradeList(raw.grades),
            })
          : await saveEvaluationGrade(input.repository, input.actor, {
              ...command,
              registrationId: text(raw.registrationId, "registrationId"),
              componentId: text(raw.componentId, "componentId"),
              gradeRevision: revision(raw.gradeRevision, "gradeRevision"),
              score: text(raw.score, "score"),
            });
    return {
      status: 200,
      payload: {
        ok: true,
        value,
        message:
          operation === "scheme"
            ? "Esquema de evaluación guardado."
            : operation === "row"
              ? "Notas de la fila registradas."
              : "Nota registrada.",
      },
    };
  } catch (error) {
    return evaluationFailure(error);
  }
}
