export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "EXCUSED"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export type EffectiveAttendance = AttendanceStatus | "PENDING";
export const ATTENDANCE_LABELS: Record<EffectiveAttendance, string> = {
  PRESENT: "Presente",
  ABSENT: "Ausente",
  EXCUSED: "Justificada",
  PENDING: "Pendiente",
};
export interface AttendanceSettingsDto {
  consecutiveAbsenceLimit: number;
  revision: number;
  updatedAt: string;
}
export interface AttendanceMarkDto {
  status: EffectiveAttendance;
  inferred: boolean;
  markedBy: string | null;
  markedByName: string | null;
  markedAt: string | null;
}
export interface AttendanceSessionDto {
  id: string;
  startsAt: string;
  endsAt: string;
  civilDate: string;
  status: "UPCOMING" | "ONGOING" | "COMPLETED" | "CANCELLED";
  revision: number;
  administrativeReviewRequired: boolean;
  replacementForSessionId: string | null;
  cancellationReason: string | null;
  canRecord: boolean;
  instructorAttendance: AttendanceMarkDto;
}
export interface AttendanceParticipantDto {
  registrationId: string;
  firstName: string;
  lastName: string;
  currentlyEnrolled: boolean;
  consecutiveAbsences: number;
  maximumConsecutiveAbsences: number;
  warning: boolean;
  academicallyEligible: boolean;
  attendance: AttendanceMarkDto;
}
export interface AttendanceGroupDto {
  courseId: string;
  courseName: string;
  groupId: string;
  instructorName: string | null;
  officialEndsAt: string;
  operationalEndsAt: string | null;
  settings: AttendanceSettingsDto;
  sessions: AttendanceSessionDto[];
}
export interface AttendanceSessionDetailDto {
  group: AttendanceGroupDto;
  session: AttendanceSessionDto;
  participants: AttendanceParticipantDto[];
  reviewCandidates: {
    registrationId: string;
    firstName: string;
    lastName: string;
  }[];
}
export interface AttendanceCommand {
  requestKey: string;
  courseId: string;
  groupId: string;
  sessionId: string;
  revision: number;
}
export interface RecordAttendanceInput extends AttendanceCommand {
  marks: readonly { registrationId: string; status: AttendanceStatus }[];
  instructorStatus?: AttendanceStatus;
  /** ADMIN explicitly establishes eligible historical roster; never inferred. */
  reviewRegistrationIds?: readonly string[];
  completeAdministrativeReview?: boolean;
}
export interface CancelSessionInput extends AttendanceCommand {
  reason?: string;
}
export interface ReplaceSessionInput extends CancelSessionInput {
  startsAt: string;
}
export interface UpdateAttendanceSettingsInput {
  requestKey: string;
  revision: number;
  consecutiveAbsenceLimit: number;
}
export type AttendanceCommandResult =
  | { kind: "session"; sessionId: string; revision: number }
  | { kind: "settings"; settings: AttendanceSettingsDto };
