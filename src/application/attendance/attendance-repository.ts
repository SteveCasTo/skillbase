import type {
  AttendanceGroupDto,
  AttendanceSessionDetailDto,
  AttendanceSettingsDto,
  AttendanceCommandResult,
  RecordAttendanceInput,
  CancelSessionInput,
  ReplaceSessionInput,
  UpdateAttendanceSettingsInput,
} from "@/domain/attendance/types";
export interface AttendanceRepository {
  getGroup(
    actorId: string,
    courseId: string,
    groupId: string,
  ): Promise<AttendanceGroupDto>;
  getSession(
    actorId: string,
    courseId: string,
    groupId: string,
    sessionId: string,
  ): Promise<AttendanceSessionDetailDto>;
  record(
    actorId: string,
    input: RecordAttendanceInput,
  ): Promise<AttendanceCommandResult>;
  cancel(
    actorId: string,
    input: CancelSessionInput,
  ): Promise<AttendanceCommandResult>;
  replace(
    actorId: string,
    input: ReplaceSessionInput,
  ): Promise<AttendanceCommandResult>;
  getSettings(actorId: string): Promise<AttendanceSettingsDto>;
  updateSettings(
    actorId: string,
    input: UpdateAttendanceSettingsInput,
  ): Promise<AttendanceCommandResult>;
}
