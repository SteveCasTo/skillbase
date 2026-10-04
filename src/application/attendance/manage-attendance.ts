import type { InternalUser } from "@/domain/auth/types";
import {
  AttendanceError,
  validateAbsenceLimit,
} from "@/domain/attendance/rules";
import { ATTENDANCE_STATUSES } from "@/domain/attendance/types";
import type {
  AttendanceCommand,
  RecordAttendanceInput,
  CancelSessionInput,
  ReplaceSessionInput,
  UpdateAttendanceSettingsInput,
} from "@/domain/attendance/types";
import type { AttendanceRepository } from "./attendance-repository";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export function attendanceId(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "El identificador no es válido.",
      { [field]: "Identificador no válido." },
    );
  return value.toLowerCase();
}
export function requireAttendanceActor(
  actor: InternalUser,
  admin = false,
): void {
  if (
    actor.status !== "ACTIVE" ||
    !(
      actor.roles.includes("ADMIN") ||
      (!admin && actor.roles.includes("INSTRUCTOR"))
    )
  )
    throw new AttendanceError(
      "FORBIDDEN",
      "No tienes autorización para esta operación.",
    );
}
export function validateAttendanceCommand(input: AttendanceCommand): void {
  for (const key of ["requestKey", "courseId", "groupId", "sessionId"] as const)
    attendanceId(input[key], key);
  if (!Number.isInteger(input.revision) || input.revision < 1)
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "Recarga la revisión vigente.",
      { revision: "Revisión no válida." },
    );
}
export function validateRecordAttendance(input: RecordAttendanceInput): void {
  validateAttendanceCommand(input);
  if (
    !Array.isArray(input.marks) ||
    input.marks.length > 1000 ||
    new Set(input.marks.map((m) => m.registrationId)).size !==
      input.marks.length
  )
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "La lista contiene marcas duplicadas o demasiados participantes.",
    );
  for (const mark of input.marks) {
    attendanceId(mark.registrationId, "registrationId");
    if (!ATTENDANCE_STATUSES.includes(mark.status))
      throw new AttendanceError(
        "VALIDATION_FAILED",
        "Estado de asistencia no válido.",
      );
  }
  if (
    input.instructorStatus !== undefined &&
    !ATTENDANCE_STATUSES.includes(input.instructorStatus)
  )
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "Estado del instructor no válido.",
    );
  if (
    input.completeAdministrativeReview !== undefined &&
    typeof input.completeAdministrativeReview !== "boolean"
  )
    throw new AttendanceError("VALIDATION_FAILED", "La revisión no es válida.");
  if (input.reviewRegistrationIds !== undefined) {
    if (
      !Array.isArray(input.reviewRegistrationIds) ||
      input.reviewRegistrationIds.length > 1000 ||
      new Set(input.reviewRegistrationIds).size !==
        input.reviewRegistrationIds.length
    )
      throw new AttendanceError(
        "VALIDATION_FAILED",
        "El roster de revisión no es válido.",
      );
    input.reviewRegistrationIds.forEach((id) =>
      attendanceId(id, "reviewRegistrationIds"),
    );
  }
}
export function validateSessionReason(reason?: string): void {
  if (
    reason !== undefined &&
    (typeof reason !== "string" ||
      reason.trim().length > 500 ||
      /\p{Cc}/u.test(reason))
  )
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "El motivo debe tener hasta 500 caracteres.",
      { reason: "Motivo no válido." },
    );
}
export async function getAttendanceGroup(
  repo: AttendanceRepository,
  actor: InternalUser,
  courseId: string,
  groupId: string,
) {
  requireAttendanceActor(actor);
  return repo.getGroup(
    actor.id,
    attendanceId(courseId, "courseId"),
    attendanceId(groupId, "groupId"),
  );
}
export async function getAttendanceSession(
  repo: AttendanceRepository,
  actor: InternalUser,
  courseId: string,
  groupId: string,
  sessionId: string,
) {
  requireAttendanceActor(actor);
  return repo.getSession(
    actor.id,
    attendanceId(courseId, "courseId"),
    attendanceId(groupId, "groupId"),
    attendanceId(sessionId, "sessionId"),
  );
}
export async function recordAttendance(
  repo: AttendanceRepository,
  actor: InternalUser,
  input: RecordAttendanceInput,
) {
  requireAttendanceActor(actor);
  validateRecordAttendance(input);
  return repo.record(actor.id, input);
}
export async function cancelAttendanceSession(
  repo: AttendanceRepository,
  actor: InternalUser,
  input: CancelSessionInput,
) {
  requireAttendanceActor(actor, true);
  validateAttendanceCommand(input);
  validateSessionReason(input.reason);
  return repo.cancel(actor.id, input);
}
export async function replaceAttendanceSession(
  repo: AttendanceRepository,
  actor: InternalUser,
  input: ReplaceSessionInput,
) {
  requireAttendanceActor(actor, true);
  validateAttendanceCommand(input);
  validateSessionReason(input.reason);
  return repo.replace(actor.id, input);
}
export async function getAttendanceSettings(
  repo: AttendanceRepository,
  actor: InternalUser,
) {
  requireAttendanceActor(actor, true);
  return repo.getSettings(actor.id);
}
export async function updateAttendanceSettings(
  repo: AttendanceRepository,
  actor: InternalUser,
  input: UpdateAttendanceSettingsInput,
) {
  requireAttendanceActor(actor, true);
  attendanceId(input.requestKey, "requestKey");
  validateAbsenceLimit(input.consecutiveAbsenceLimit);
  if (!Number.isInteger(input.revision) || input.revision < 1)
    throw new AttendanceError("VALIDATION_FAILED", "Revisión no válida.");
  return repo.updateSettings(actor.id, input);
}
