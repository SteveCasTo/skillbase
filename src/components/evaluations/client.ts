import type { EvaluationHttpPayload } from "@/server/evaluations/http";
import type { EvaluationLoadResult } from "@/server/evaluations/loaders";
import type {
  SaveEvaluationSchemeInput,
  SaveEvaluationRowInput,
  CourseEvaluationsDto,
} from "@/domain/evaluations/types";
import type { EvaluationSaveResult } from "./mutation-types";

export async function saveEvaluation(
  path: string,
  input: SaveEvaluationSchemeInput | SaveEvaluationRowInput,
  currentData?: CourseEvaluationsDto,
): Promise<EvaluationSaveResult> {
  // Course/group and actor are authoritative route/session context, not body fields.
  const body =
    "grades" in input
      ? {
          requestKey: input.requestKey,
          schemeRevision: input.schemeRevision,
          registrationId: input.registrationId,
          grades: input.grades,
        }
      : {
          requestKey: input.requestKey,
          schemeRevision: input.schemeRevision,
          components: input.components,
        };
  const response = await fetch(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  // The atomic row acknowledgement contains the complete authoritative row.
  const row = payload.value.kind === "row" ? payload.value : null;
  const acknowledged =
    row && currentData
      ? {
          ...currentData,
          scheme: {
            ...currentData.scheme,
            revision: row.schemeRevision,
            canEdit: false,
          },
          participants: currentData.participants.map((participant) =>
            participant.registrationId === row.registrationId
              ? {
                  ...participant,
                  grades: row.grades,
                  result: row.result,
                }
              : participant,
          ),
        }
      : null;
  // Refresh freeze timestamp, permissions and ADMIN history, without retrying any writes.
  try {
    const refresh = await fetch(path, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const load = (await refresh.json()) as EvaluationLoadResult;
    if (load.available) return { ok: true, value: load.data };
  } catch {
    /* A row remains confirmed even if the ancillary full-DTO refresh fails. */
  }
  if (acknowledged) return { ok: true, value: acknowledged };
  return {
    ok: false,
    code: "REFRESH_FAILED",
    message:
      "El guardado se confirmó, pero no se pudo actualizar la vista. Reintenta para recuperar los datos guardados.",
    issues: {},
  };
}
