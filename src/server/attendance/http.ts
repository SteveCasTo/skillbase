import type { InternalUser } from "@/domain/auth/types";
import { AttendanceError } from "@/domain/attendance/rules";
import type {
  AttendanceCommandResult,
  AttendanceStatus,
} from "@/domain/attendance/types";
import type { AttendanceRepository } from "@/application/attendance/attendance-repository";
import {
  cancelAttendanceSession,
  recordAttendance,
  replaceAttendanceSession,
  updateAttendanceSettings,
  requireAttendanceActor,
} from "@/application/attendance/manage-attendance";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { readInterestRequest } from "@/server/interests/request";
import { InterestError } from "@/domain/interests/rules";
import { CourseDomainError } from "@/domain/courses/errors";
export type AttendanceOperation = "record" | "cancel" | "replace" | "settings";
export type AttendanceHttpPayload =
  | { ok: true; value: AttendanceCommandResult; message: string }
  | {
      ok: false;
      code: string;
      message: string;
      issues: Readonly<Record<string, string>>;
    };
export const attendanceHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function attendanceJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...attendanceHeaders, "Content-Type": "application/json" },
  });
}
export function attendanceFailure(error: unknown): {
  status: number;
  payload: Extract<AttendanceHttpPayload, { ok: false }>;
} {
  if (error instanceof AttendanceError)
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
                  "SCHEDULE_CONFLICT",
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
  if (error instanceof CourseDomainError)
    return {
      status: 422,
      payload: {
        ok: false,
        code: error.code,
        message: error.message,
        issues: error.fieldErrors,
      },
    };
  return {
    status: 503,
    payload: {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message:
        "No se pudo confirmar la operación. Conserva los datos y reintenta la misma solicitud.",
      issues: {},
    },
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "La solicitud no es válida.",
    );
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, optional = false): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string")
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "Envía un valor de texto válido.",
      { [field]: "Valor no válido." },
    );
  return value;
}
function integer(value: unknown, field: string): number {
  if (typeof value === "string" && /^\d+$/u.test(value)) value = Number(value);
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "Introduce un entero válido.",
      { [field]: "Introduce un entero válido." },
    );
  return value;
}
function list(value: unknown): unknown[] {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new AttendanceError("VALIDATION_FAILED", "La lista no es válida.");
    }
  }
  if (!Array.isArray(value))
    throw new AttendanceError("VALIDATION_FAILED", "La lista no es válida.");
  return value as unknown[];
}
function bool(value: unknown): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new AttendanceError(
    "VALIDATION_FAILED",
    "El valor de revisión no es válido.",
  );
}
export async function handleAttendancePost(input: {
  request: Request;
  actor: InternalUser;
  repository: AttendanceRepository;
  siteUrl: URL;
  operation: AttendanceOperation;
  courseId?: string;
  groupId?: string;
  sessionId?: string;
}): Promise<{ status: number; payload: AttendanceHttpPayload }> {
  try {
    requireAttendanceActor(input.actor, input.operation !== "record");
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
    const raw = object(await readInterestRequest(input.request, 65_536));
    const allowed = new Set([
      "requestKey",
      "revision",
      ...(input.operation === "settings"
        ? ["consecutiveAbsenceLimit"]
        : [
            "courseId",
            "groupId",
            "sessionId",
            ...(input.operation === "record"
              ? [
                  "marks",
                  "instructorStatus",
                  "reviewRegistrationIds",
                  "completeAdministrativeReview",
                ]
              : input.operation === "replace"
                ? ["startsAt", "reason"]
                : ["reason"]),
          ]),
    ]);
    if (Object.keys(raw).some((key) => !allowed.has(key)))
      throw new AttendanceError(
        "VALIDATION_FAILED",
        "La solicitud contiene campos no admitidos.",
      );
    const base = {
      requestKey: text(raw.requestKey, "requestKey"),
      revision: integer(raw.revision, "revision"),
    };
    let value: AttendanceCommandResult;
    if (input.operation === "settings")
      value = await updateAttendanceSettings(input.repository, input.actor, {
        ...base,
        consecutiveAbsenceLimit: integer(
          raw.consecutiveAbsenceLimit,
          "consecutiveAbsenceLimit",
        ),
      });
    else {
      const command = {
        ...base,
        courseId: text(input.courseId, "courseId"),
        groupId: text(input.groupId, "groupId"),
        sessionId: text(input.sessionId, "sessionId"),
      };
      for (const key of ["courseId", "groupId", "sessionId"] as const)
        if (raw[key] !== undefined && raw[key] !== command[key])
          throw new AttendanceError(
            "VALIDATION_FAILED",
            "La solicitud no corresponde a esta ruta.",
          );
      if (input.operation === "record") {
        const marks = list(raw.marks ?? []).map((item) => {
          const m = object(item);
          if (
            Object.keys(m).some((k) => k !== "registrationId" && k !== "status")
          )
            throw new AttendanceError(
              "VALIDATION_FAILED",
              "La marca contiene campos no admitidos.",
            );
          return {
            registrationId: text(m.registrationId, "registrationId"),
            status: text(m.status, "status") as AttendanceStatus,
          };
        });
        value = await recordAttendance(input.repository, input.actor, {
          ...command,
          marks,
          ...(raw.instructorStatus !== undefined
            ? {
                instructorStatus: text(
                  raw.instructorStatus,
                  "instructorStatus",
                ) as AttendanceStatus,
              }
            : {}),
          ...(raw.reviewRegistrationIds !== undefined
            ? {
                reviewRegistrationIds: list(raw.reviewRegistrationIds).map(
                  (id) => text(id, "reviewRegistrationIds"),
                ),
              }
            : {}),
          ...(raw.completeAdministrativeReview !== undefined
            ? {
                completeAdministrativeReview: bool(
                  raw.completeAdministrativeReview,
                ),
              }
            : {}),
        });
      } else if (input.operation === "cancel")
        value = await cancelAttendanceSession(input.repository, input.actor, {
          ...command,
          reason: text(raw.reason, "reason", true),
        });
      else if (input.operation === "replace")
        value = await replaceAttendanceSession(input.repository, input.actor, {
          ...command,
          reason: text(raw.reason, "reason", true),
          startsAt: text(raw.startsAt, "startsAt"),
        });
      else
        throw new AttendanceError(
          "VALIDATION_FAILED",
          "La operación no es válida.",
        );
    }
    return {
      status: 200,
      payload: {
        ok: true,
        value,
        message:
          input.operation === "settings"
            ? "Configuración actualizada."
            : input.operation === "record"
              ? "Asistencia registrada."
              : input.operation === "replace"
                ? "Sesión reprogramada."
                : "Sesión cancelada.",
      },
    };
  } catch (error) {
    return attendanceFailure(error);
  }
}
