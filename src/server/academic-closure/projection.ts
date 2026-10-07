import type {
  AuthorizedClosureReportDto,
  ClosureReportDto,
} from "@/domain/academic-closure/types";
import type { AttendanceMarkDto } from "@/domain/attendance/types";

function attendanceMark(mark: AttendanceMarkDto): AttendanceMarkDto {
  return {
    status: mark.status,
    inferred: mark.inferred,
    markedBy: mark.markedBy,
    markedByName: mark.markedByName,
    markedAt: mark.markedAt,
  };
}
/** Caller derives ADMIN from fresh transactional roles, never a request field.
 * Instructor output is a recursive allowlist: no spread of stored/private data,
 * including when future snapshots acquire contact or financial attributes. */
export function privateClosureReport(
  report: ClosureReportDto,
  admin: boolean,
): AuthorizedClosureReportDto {
  if (admin) return { ...report, access: "ADMIN" };
  return {
    access: "INSTRUCTOR",
    courseId: report.courseId,
    courseName: report.courseName,
    groupId: report.groupId,
    groupName: report.groupName,
    instructorId: report.instructorId,
    instructorName: report.instructorName,
    minimumGrade: report.minimumGrade,
    scheme: {
      revision: report.scheme.revision,
      frozenAt: report.scheme.frozenAt,
      modality: report.scheme.modality,
      canEdit: report.scheme.canEdit,
      components: report.scheme.components.map((component) => ({
        id: component.id,
        name: component.name,
        type: component.type,
        weight: component.weight,
        order: component.order,
      })),
    },
    attendanceSettings: {
      consecutiveAbsenceLimit:
        report.attendanceSettings.consecutiveAbsenceLimit,
      revision: report.attendanceSettings.revision,
      updatedAt: report.attendanceSettings.updatedAt,
    },
    participants: report.participants.map((person) => ({
      participantId: person.participantId,
      registrationId: person.registrationId,
      groupId: person.groupId,
      firstName: person.firstName,
      lastName: person.lastName,
      membershipStatus: person.membershipStatus,
      canGrade: person.canGrade,
      grades: person.grades.map((grade) => ({
        componentId: grade.componentId,
        score: grade.score,
        revision: grade.revision,
        recordedBy: null,
        recordedByName: grade.recordedByName ?? null,
        recordedAt: grade.recordedAt,
      })),
      result: {
        status: person.result.status,
        finalGrade: person.result.finalGrade,
        decisionGrade: person.result.decisionGrade,
        passed: person.result.passed,
        missingComponentIds: [...person.result.missingComponentIds],
      },
      attendance: {
        present: person.attendance.present,
        absent: person.attendance.absent,
        excused: person.attendance.excused,
        pending: person.attendance.pending,
        consecutiveAbsences: person.attendance.consecutiveAbsences,
        maximumConsecutiveAbsences:
          person.attendance.maximumConsecutiveAbsences,
        warning: person.attendance.warning,
        academicallyEligible: person.attendance.academicallyEligible,
      },
      academicallyPassed: person.academicallyPassed,
    })),
    sessions: report.sessions.map((session) => ({
      id: session.id,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      cancelledAt: session.cancelledAt,
      cancellationReason: session.cancellationReason,
      replacementForSessionId: session.replacementForSessionId,
      administrativeReviewRequired: session.administrativeReviewRequired,
      revision: session.revision,
      instructorAttendance: attendanceMark(session.instructorAttendance),
      participants: session.participants.map((person) => ({
        registrationId: person.registrationId,
        firstName: person.firstName,
        lastName: person.lastName,
        attendance: attendanceMark(person.attendance),
      })),
    })),
  };
}
