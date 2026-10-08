import type {
  AttendanceMarkDto,
  AttendanceSettingsDto,
} from "@/domain/attendance/types";
import type {
  EvaluationParticipantDto,
  EvaluationSchemeDto,
} from "@/domain/evaluations/types";

export interface ClosureCommand {
  courseId: string;
  groupId: string;
  requestKey: string;
  revision: number;
}
export interface ReopenGroupInput extends ClosureCommand {
  reason: string;
}
export type ClosureBlocker =
  "SESSIONS_UNFINISHED" | "GRADES_PENDING" | "ATTENDANCE_PENDING";
export interface ClosureSessionDto {
  id: string;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  replacementForSessionId: string | null;
  administrativeReviewRequired: boolean;
  revision: number;
  instructorAttendance: AttendanceMarkDto;
  participants: {
    registrationId: string;
    firstName: string;
    lastName: string;
    attendance: AttendanceMarkDto;
  }[];
}
export interface ClosureParticipantDto extends EvaluationParticipantDto {
  ci: string;
  /** Informative only; never a closing prerequisite. Redacted for instructors. */
  balanceCents: number | null;
  attendance: {
    present: number;
    absent: number;
    excused: number;
    pending: number;
    consecutiveAbsences: number;
    maximumConsecutiveAbsences: number;
    warning: boolean;
    academicallyEligible: boolean;
  };
  /** Official combined result, distinct from the grade-only classification. */
  academicallyPassed: boolean;
}
export interface ClosureReportDto {
  courseId: string;
  courseName: string;
  groupId: string;
  groupName: string;
  instructorId: string | null;
  instructorName: string | null;
  minimumGrade: number;
  scheme: EvaluationSchemeDto;
  attendanceSettings: AttendanceSettingsDto;
  participants: ClosureParticipantDto[];
  sessions: ClosureSessionDto[];
}
/** Persisted reports retain complete private identity. Only these role-specific
 * projections may leave an authorized loader or feed an export renderer. */
export type AdminClosureReportDto = ClosureReportDto & { access: "ADMIN" };
export type InstructorClosureParticipantDto = Pick<
  ClosureParticipantDto,
  | "participantId"
  | "registrationId"
  | "groupId"
  | "firstName"
  | "lastName"
  | "membershipStatus"
  | "canGrade"
  | "grades"
  | "result"
  | "attendance"
  | "academicallyPassed"
>;
export type InstructorClosureReportDto = Pick<
  ClosureReportDto,
  | "courseId"
  | "courseName"
  | "groupId"
  | "groupName"
  | "instructorId"
  | "instructorName"
  | "minimumGrade"
  | "scheme"
  | "attendanceSettings"
  | "sessions"
> & {
  access: "INSTRUCTOR";
  participants: InstructorClosureParticipantDto[];
};
export type AuthorizedClosureReportDto =
  AdminClosureReportDto | InstructorClosureReportDto;
export interface ClosureVersionDto {
  id: string;
  version: number;
  closedAt: string;
  actorId: string;
  actorName: string;
  report: AuthorizedClosureReportDto;
}
export interface ClosureStateDto {
  courseId: string;
  groupId: string;
  status: "OPEN" | "CLOSED";
  revision: number;
  canClose: boolean;
  canReopen: boolean;
  blockers: ClosureBlocker[];
  /** Null while open, including after reopening; history remains available. */
  official: ClosureVersionDto | null;
  provisional: AuthorizedClosureReportDto | null;
  history: Omit<ClosureVersionDto, "report">[];
  reopenings: {
    version: number;
    reopenedAt: string;
    actorId: string;
    actorName: string;
    reason: string;
  }[];
}
export interface ClosureCommandResult {
  groupId: string;
  status: "OPEN" | "CLOSED";
  revision: number;
  version: number;
  versionId: string;
}
