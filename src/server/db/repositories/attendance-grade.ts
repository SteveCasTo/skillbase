import { and, eq } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { effectiveAttendance } from "@/domain/attendance/rules";
import { attendanceGradeHundredths } from "@/domain/evaluations/attendance-grade";
import { evaluationHundredths } from "@/domain/evaluations/rules";
import type { AttendanceTransaction } from "./attendance-calendar";
import {
  eligibleSessionRegistrations,
  loadGroupEligibility,
} from "./attendance-calendar";

/** Pure read model: ordinary roster uses the same legitimate activation chronology
 * as attendance; reviewed historical rosters are exclusively the explicit rows.
 * Callers hold the shared schedule/course gate, including close and grade writes. */
export async function loadAttendanceGradeEvidence(
  tx: AttendanceTransaction,
  course: typeof s.courses.$inferSelect,
  groupId: string,
  now: Date,
  source?: {
    sessions: (typeof s.groupSessions.$inferSelect)[];
    roster: {
      row: Pick<
        typeof s.sessionRoster.$inferSelect,
        "sessionId" | "registrationId"
      >;
    }[];
    marks: { row: typeof s.participantAttendance.$inferSelect }[];
    instructors: { row: typeof s.instructorAttendance.$inferSelect }[];
  },
) {
  const sessions =
    source?.sessions ??
    (await tx
      .select()
      .from(s.groupSessions)
      .where(eq(s.groupSessions.groupId, groupId)));
  const roster =
    source?.roster ??
    (await tx
      .select({ row: s.sessionRoster })
      .from(s.sessionRoster)
      .innerJoin(
        s.groupSessions,
        eq(s.groupSessions.id, s.sessionRoster.sessionId),
      )
      .where(eq(s.groupSessions.groupId, groupId)));
  const marks =
    source?.marks ??
    (await tx
      .select({ row: s.participantAttendance })
      .from(s.participantAttendance)
      .innerJoin(
        s.groupSessions,
        eq(s.groupSessions.id, s.participantAttendance.sessionId),
      )
      .where(eq(s.groupSessions.groupId, groupId)));
  const instructors =
    source?.instructors ??
    (await tx
      .select({ row: s.instructorAttendance })
      .from(s.instructorAttendance)
      .innerJoin(
        s.groupSessions,
        eq(s.groupSessions.id, s.instructorAttendance.sessionId),
      )
      .where(eq(s.groupSessions.groupId, groupId)));
  const eligibility = await loadGroupEligibility(
    tx,
    groupId,
    course.startsAt,
    now,
  );
  const evidence = await Promise.all(
    sessions.map(async (session) => {
      const explicit = roster
        .filter(({ row }) => row.sessionId === session.id)
        .map(({ row }) => row.registrationId);
      const derived =
        !session.cancelledAt &&
        !session.administrativeReviewRequired &&
        !session.rosterReviewedAt
          ? (
              await eligibleSessionRegistrations(
                tx,
                groupId,
                course.startsAt,
                session,
                now,
                eligibility,
              )
            ).map(({ registration }) => registration.id)
          : [];
      const registrationIds = [...new Set([...explicit, ...derived])];
      const participants = registrationIds.map((registrationId) => {
        const mark = marks.find(
          ({ row }) =>
            row.sessionId === session.id &&
            row.registrationId === registrationId,
        )?.row;
        return {
          registrationId,
          status: effectiveAttendance(
            mark?.status ?? null,
            session.startsAt,
            session.administrativeReviewRequired,
            now,
          ),
        };
      });
      const instructor = instructors.find(
        ({ row }) => row.sessionId === session.id,
      )?.row;
      return {
        session,
        participants,
        instructorStatus: effectiveAttendance(
          instructor?.status ?? null,
          session.startsAt,
          session.administrativeReviewRequired,
          now,
        ),
      };
    }),
  );
  const active = evidence.filter(({ session }) => !session.cancelledAt);
  const ready =
    sessions.length > 0 &&
    active.every(
      ({ session, participants, instructorStatus }) =>
        session.endsAt <= now &&
        !session.administrativeReviewRequired &&
        (!course.instructorId || instructorStatus !== "PENDING") &&
        participants.every((p) => p.status !== "PENDING"),
    );
  return {
    ready,
    evidence,
    eligibility,
    score(registrationId: string) {
      return attendanceGradeHundredths(
        active
          .filter(({ session }) => session.startsAt <= now)
          .flatMap(({ participants }) =>
            participants
              .filter((p) => p.registrationId === registrationId)
              .map((p) => p.status),
          ),
      );
    },
  };
}

export type AttendanceGradeEvidence = Awaited<
  ReturnType<typeof loadAttendanceGradeEvidence>
>;

/** A persisted automatic value is evidence of a previous finalization, not a
 * cache authority after reopening/correcting attendance. Manual overrides win. */
export function effectiveEvaluationGrades(
  components: readonly (typeof s.evaluationComponents.$inferSelect)[],
  grades: readonly (typeof s.evaluationGrades.$inferSelect)[],
  registrationId: string,
  attendance: AttendanceGradeEvidence,
) {
  return components.flatMap((component) => {
    const grade = grades.find((g) => g.componentId === component.id);
    if (component.type !== "ATTENDANCE" || grade?.origin === "MANUAL")
      return grade ? [grade] : [];
    const scoreHundredths = attendance.score(registrationId);
    return scoreHundredths === null
      ? []
      : [{ componentId: component.id, scoreHundredths }];
  });
}

export async function persistAttendanceGrades(
  tx: AttendanceTransaction,
  courseId: string,
  people: readonly {
    participantId: string;
    registrationId: string;
    grades: readonly { componentId: string; score: string | null }[];
  }[],
  actorId: string,
  now: Date,
) {
  const components = await tx
    .select()
    .from(s.evaluationComponents)
    .where(
      and(
        eq(s.evaluationComponents.courseId, courseId),
        eq(s.evaluationComponents.type, "ATTENDANCE"),
      ),
    );
  const grades = await tx
    .select()
    .from(s.evaluationGrades)
    .where(eq(s.evaluationGrades.courseId, courseId));
  for (const person of people)
    for (const component of components) {
      const old = grades.find(
        (g) =>
          g.componentId === component.id &&
          g.participantId === person.participantId,
      );
      if (old?.origin === "MANUAL") continue;
      const score = person.grades.find(
        (g) => g.componentId === component.id,
      )?.score;
      if (score == null) continue;
      const scoreHundredths = evaluationHundredths(score, "score");
      if (old?.scoreHundredths === scoreHundredths) continue;
      const value = {
        courseId,
        componentId: component.id,
        participantId: person.participantId,
        registrationId: person.registrationId,
        scoreHundredths,
        origin: "AUTO" as const,
        revision: (old?.revision ?? 0) + 1,
        recordedBy: actorId,
        recordedAt: now,
      };
      await tx
        .insert(s.evaluationGrades)
        .values(value)
        .onConflictDoUpdate({
          target: [
            s.evaluationGrades.courseId,
            s.evaluationGrades.participantId,
            s.evaluationGrades.componentId,
          ],
          set: value,
        });
    }
}
