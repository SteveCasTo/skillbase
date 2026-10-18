import {
  ATTENDANCE_STATUSES,
  type AttendanceCommandResult,
  type AttendanceMarkDto,
  type AttendanceStatus,
  type AttendanceSessionDto,
} from "@/domain/attendance/types";
import type { AttendanceHttpPayload } from "@/server/attendance/http";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(
  value: unknown,
): value is Readonly<Record<string, string>> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isAttendanceCommandResult(
  value: unknown,
): value is AttendanceCommandResult {
  if (!isRecord(value)) return false;
  if (value.kind === "session")
    return (
      typeof value.sessionId === "string" &&
      Number.isSafeInteger(value.revision)
    );
  if (value.kind === "settings" && isRecord(value.settings))
    return (
      Number.isSafeInteger(value.settings.consecutiveAbsenceLimit) &&
      Number.isSafeInteger(value.settings.revision) &&
      typeof value.settings.updatedAt === "string"
    );
  return false;
}

/** Reject status/body mismatches and malformed business payloads before UI success. */
export function parseAttendanceHttpPayload(
  value: unknown,
  httpSuccess: boolean,
): AttendanceHttpPayload | undefined {
  if (
    !isRecord(value) ||
    typeof value.ok !== "boolean" ||
    value.ok !== httpSuccess
  )
    return undefined;
  if (value.ok)
    return typeof value.message === "string" &&
      isAttendanceCommandResult(value.value)
      ? { ok: true, value: value.value, message: value.message }
      : undefined;
  return typeof value.code === "string" &&
    typeof value.message === "string" &&
    isStringRecord(value.issues)
    ? {
        ok: false,
        code: value.code,
        message: value.message,
        issues: value.issues,
      }
    : undefined;
}

export const sessionLabels: Record<AttendanceSessionDto["status"], string> = {
  UPCOMING: "Próxima",
  ONGOING: "En curso",
  COMPLETED: "Finalizada",
  CANCELLED: "Cancelada",
};
export const dateLabel = (instant: string) =>
  new Intl.DateTimeFormat("es-BO", {
    timeZone: "America/La_Paz",
    dateStyle: "medium",
  }).format(new Date(instant));
export const timeLabel = (instant: string) =>
  instantToBoliviaCivil(new Date(instant)).slice(11, 16);
export const markValue = (
  registrationId: string,
  status: AttendanceMarkDto["status"],
) => (status === "PENDING" ? "" : JSON.stringify([{ registrationId, status }]));
export function attendanceFormPayload(
  values: Readonly<Record<string, string>>,
  operation?: string,
): Record<string, string> {
  const payload = { ...values };
  if (
    operation === "cancel" &&
    ["holiday", "other"].includes(payload.cancellationReasonChoice ?? "")
  ) {
    if (payload.cancellationReasonChoice === "holiday")
      payload.reason = "Feriado";
    delete payload.cancellationReasonChoice;
  }
  if ("replacementDate" in payload || "replacementTime" in payload) {
    payload.startsAt = `${payload.replacementDate ?? ""}T${payload.replacementTime ?? ""}`;
    delete payload.replacementDate;
    delete payload.replacementTime;
  }
  return payload;
}
export function sessionCancellationLabel(
  session: Pick<AttendanceSessionDto, "status" | "cancellationReason">,
) {
  return session.status === "CANCELLED"
    ? (session.cancellationReason?.trim() ?? "")
    : "";
}
export function validMarkValue(value: string): boolean {
  try {
    const marks = JSON.parse(value) as {
      registrationId?: unknown;
      status?: unknown;
    }[];
    return (
      Array.isArray(marks) &&
      marks.length === 1 &&
      typeof marks[0]?.registrationId === "string" &&
      ATTENDANCE_STATUSES.includes(marks[0].status as AttendanceStatus)
    );
  } catch {
    return false;
  }
}
export function attendanceFieldIssues(
  issues: Readonly<Record<string, string>>,
) {
  return issues.startsAt
    ? {
        ...issues,
        replacementDate: issues.startsAt,
        replacementTime: issues.startsAt,
      }
    : { ...issues };
}
export function durationLabel(
  session: Pick<AttendanceSessionDto, "startsAt" | "endsAt">,
) {
  const minutes =
    (new Date(session.endsAt).getTime() -
      new Date(session.startsAt).getTime()) /
    60_000;
  const hours = Math.floor(minutes / 60),
    remainder = minutes % 60;
  return [hours ? `${hours} h` : "", remainder ? `${remainder} min` : ""]
    .filter(Boolean)
    .join(" ");
}
