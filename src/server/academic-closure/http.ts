import type { InternalUser } from "@/domain/auth/types";
import type { ClosureRepository } from "@/application/academic-closure/closure-repository";
import {
  closeAcademicGroup,
  reopenAcademicGroup,
  requireClosureActor,
} from "@/application/academic-closure/manage-closure";
import { ClosureError } from "@/domain/academic-closure/rules";
import type { ClosureCommandResult } from "@/domain/academic-closure/types";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { readInterestRequest } from "@/server/interests/request";
import { InterestError } from "@/domain/interests/rules";

export type ClosureOperation = "close" | "reopen";
export type ClosureHttpPayload =
  | { ok: true; value: ClosureCommandResult; message: string }
  | {
      ok: false;
      code: string;
      message: string;
      issues: Readonly<Record<string, string>>;
    };
export const closureHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function closureJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...closureHeaders, "Content-Type": "application/json" },
  });
}
export function closureFailure(error: unknown): {
  status: number;
  payload: Extract<ClosureHttpPayload, { ok: false }>;
} {
  if (error instanceof ClosureError)
    return {
      status:
        error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND"
            ? 404
            : [
                  "CONCURRENT_UPDATE",
                  "IDEMPOTENCY_CONFLICT",
                  "GROUP_CLOSED",
                  "GROUP_OPEN",
                  "CLOSURE_BLOCKED",
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
        "No se pudo confirmar la operación. Reintenta la misma solicitud.",
      issues: {},
    },
  };
}
/** Reserved SSR/REST adapter. Route fixes operation/course/group; actor is the
 * fresh server session. Never accept an actor or timestamp from the body. */
export async function handleClosurePost(input: {
  request: Request;
  actor: InternalUser;
  repository: ClosureRepository;
  siteUrl: URL;
  operation: ClosureOperation;
  courseId: string;
  groupId: string;
}): Promise<{ status: number; payload: ClosureHttpPayload }> {
  try {
    requireClosureActor(input.actor, input.operation === "reopen");
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
    const value: unknown = await readInterestRequest(input.request, 65536);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new ClosureError("VALIDATION_FAILED", "Solicitud no válida.");
    const raw = value as Record<string, unknown>;
    const fields = [
      "requestKey",
      "revision",
      "courseId",
      "groupId",
      ...(input.operation === "reopen" ? ["reason"] : []),
    ];
    if (Object.keys(raw).some((field) => !fields.includes(field)))
      throw new ClosureError(
        "VALIDATION_FAILED",
        "La solicitud contiene campos no admitidos.",
      );
    if (
      (raw.courseId !== undefined && raw.courseId !== input.courseId) ||
      (raw.groupId !== undefined && raw.groupId !== input.groupId)
    )
      throw new ClosureError(
        "VALIDATION_FAILED",
        "La solicitud no corresponde a esta ruta.",
      );
    const revision =
      typeof raw.revision === "string" && /^\d+$/u.test(raw.revision)
        ? Number(raw.revision)
        : raw.revision;
    if (typeof raw.requestKey !== "string" || typeof revision !== "number")
      throw new ClosureError(
        "VALIDATION_FAILED",
        "Clave o revisión no válida.",
      );
    const command = {
      courseId: input.courseId,
      groupId: input.groupId,
      requestKey: raw.requestKey,
      revision,
    };
    if (input.operation === "reopen" && typeof raw.reason !== "string")
      throw new ClosureError(
        "VALIDATION_FAILED",
        "Indica el motivo de reapertura.",
        { reason: "Motivo obligatorio." },
      );
    const result =
      input.operation === "close"
        ? await closeAcademicGroup(input.repository, input.actor, command)
        : await reopenAcademicGroup(input.repository, input.actor, {
            ...command,
            reason: raw.reason as string,
          });
    return {
      status: 200,
      payload: {
        ok: true,
        value: result,
        message:
          input.operation === "close"
            ? "Grupo cerrado. Se conservó una versión oficial."
            : "Grupo reabierto para correcciones.",
      },
    };
  } catch (error) {
    return closureFailure(error);
  }
}
