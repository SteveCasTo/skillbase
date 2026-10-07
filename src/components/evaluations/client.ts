import type { EvaluationHttpPayload } from "@/server/evaluations/http";
import type { EvaluationLoadResult } from "@/server/evaluations/loaders";
import type {
  SaveEvaluationGradeInput,
  SaveEvaluationSchemeInput,
} from "@/domain/evaluations/types";
import type { EvaluationSaveResult } from "./mutation-types";

export async function saveEvaluation(
  path: string,
  input: SaveEvaluationGradeInput | SaveEvaluationSchemeInput,
): Promise<EvaluationSaveResult> {
  const response = await fetch(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as EvaluationHttpPayload;
  if (!payload.ok) {
    if (
      payload.code === "CONCURRENT_UPDATE" ||
      payload.code === "SCHEME_FROZEN"
    ) {
      try {
        const refresh = await fetch(path, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const load = (await refresh.json()) as EvaluationLoadResult;
        if (load.available) return { ...payload, currentData: load.data };
      } catch {
        /* The original error still applies; retain the attempted values. */
      }
    }
    return payload;
  }
  // Acknowledgement is not an invented grade/result: re-read the authoritative DTO.
  try {
    const refresh = await fetch(path, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const load = (await refresh.json()) as EvaluationLoadResult;
    if (load.available) return { ok: true, value: load.data };
  } catch {
    /* Keep the same operation key for an idempotent retry. */
  }
  return {
    ok: false,
    code: "REFRESH_FAILED",
    message:
      "El guardado se confirmó, pero no se pudo actualizar la vista. Reintenta para recuperar los datos guardados.",
    issues: {},
  };
}
