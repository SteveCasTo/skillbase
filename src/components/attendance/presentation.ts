import {
  ATTENDANCE_STATUSES,
  type AttendanceMarkDto,
  type AttendanceStatus,
  type AttendanceSessionDto,
} from "@/domain/attendance/types";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
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
