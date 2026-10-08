import { eq, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { AttendanceTransaction } from "./attendance-calendar";
import { hasClosureActorActivity } from "@/server/academic-closure/actor-dependencies";

/** Targets of another actor's account creation are deliberately not activity. */
export async function hasAdminActorActivity(
  tx: AttendanceTransaction,
  id: string,
): Promise<boolean> {
  const [row] = await tx
    .select({
      used: sql<boolean>`
    exists(select 1 from ${s.auditEvents} where ${eq(s.auditEvents.actorId, id)})
    or exists(select 1 from ${s.courses} where ${eq(s.courses.createActorId, id)})
    or exists(select 1 from ${s.courseInstructorHistory} where ${eq(s.courseInstructorHistory.actorId, id)})
    or exists(select 1 from ${s.registrationSettings} where ${eq(s.registrationSettings.updatedBy, id)})
    or exists(select 1 from ${s.preRegistrations} where ${eq(s.preRegistrations.createdBy, id)} or ${eq(s.preRegistrations.cancelledBy, id)})
    or exists(select 1 from ${s.registrationLedger} where ${eq(s.registrationLedger.actorId, id)})
    or exists(select 1 from ${s.registrationCommandReceipts} where ${eq(s.registrationCommandReceipts.actorId, id)})
    or exists(select 1 from ${s.attendanceSettings} where ${eq(s.attendanceSettings.updatedBy, id)})
    or exists(select 1 from ${s.groupSessions} where ${eq(s.groupSessions.cancelledBy, id)})
    or exists(select 1 from ${s.sessionRoster} where ${eq(s.sessionRoster.reviewedBy, id)})
    or exists(select 1 from ${s.participantAttendance} where ${eq(s.participantAttendance.markedBy, id)})
    or exists(select 1 from ${s.instructorAttendance} where ${eq(s.instructorAttendance.markedBy, id)})
    or exists(select 1 from ${s.attendanceCommandReceipts} where ${eq(s.attendanceCommandReceipts.actorId, id)})
    or exists(select 1 from ${s.evaluationSchemes} where ${eq(s.evaluationSchemes.updatedBy, id)})
    or exists(select 1 from ${s.evaluationGrades} where ${eq(s.evaluationGrades.recordedBy, id)})
    or exists(select 1 from ${s.evaluationCommandReceipts} where ${eq(s.evaluationCommandReceipts.actorId, id)})
    or exists(select 1 from ${s.instructorAccountDeletions} where ${eq(s.instructorAccountDeletions.actorId, id)})
    or exists(select 1 from ${s.adminAccountDeletions} where ${eq(s.adminAccountDeletions.actorId, id)})
    or exists(select 1 from ${s.authGoogleLinkRequests} where ${eq(s.authGoogleLinkRequests.userId, id)})
    or exists(select 1 from ${s.instructorProfiles} where ${eq(s.instructorProfiles.id, id)})
    or exists(select 1 from ${s.certificates} where ${eq(s.certificates.createdBy, id)} or ${eq(s.certificates.instructorId, id)})
    or exists(select 1 from ${s.certificateEvents} where ${eq(s.certificateEvents.actorId, id)})
    or exists(select 1 from ${s.certificateReceipts} where ${eq(s.certificateReceipts.actorId, id)})
    or exists(select 1 from ${s.certificateSettings} where ${eq(s.certificateSettings.updatedBy, id)})
    or exists(select 1 from ${s.certificateArtifacts} where ${eq(s.certificateArtifacts.actorId, id)})
  `,
    })
    .from(s.users)
    .where(eq(s.users.id, id));
  return Boolean(row?.used) || (await hasClosureActorActivity(tx, id));
}
