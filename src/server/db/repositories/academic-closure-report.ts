import { and, asc, eq, lte, sql } from "drizzle-orm";
import { compareParticipantNames } from "@/domain/pre-registrations/participant-name";
import * as s from "@/server/db/schema";
import type {
  ClosureReportDto,
  ClosureVersionDto,
} from "@/domain/academic-closure/types";
import {
  attendanceSummary,
  effectiveAttendance,
} from "@/domain/attendance/rules";
import {
  evaluationDecimal,
  evaluationModality,
  evaluationResult,
} from "@/domain/evaluations/rules";
import type { AttendanceMarkDto } from "@/domain/attendance/types";
import type { AttendanceTransaction, SessionRow } from "./attendance-calendar";
import {
  effectiveEvaluationGrades,
  loadAttendanceGradeEvidence,
} from "./attendance-grade";
import { loadEvaluationRoster } from "./evaluation-repository";
import { registrationGroupName } from "./registration-support";
export { privateClosureReport } from "@/server/academic-closure/projection";

export function closureVersionDto(
  row: typeof s.academicClosureVersions.$inferSelect,
): Omit<ClosureVersionDto, "report"> & { report: ClosureReportDto } {
  return {
    id: row.id,
    version: row.version,
    closedAt: row.closedAt.toISOString(),
    actorId: row.actorId,
    actorName: row.actorName,
    report: row.report,
  };
}
/** Caller holds schedule/course/group locks. Reads and close use the same authoritative
 * projection; historical review is never completed implicitly. */
export async function buildClosureReport(
  tx: AttendanceTransaction,
  course: typeof s.courses.$inferSelect,
  group: typeof s.groups.$inferSelect,
  now: Date,
): Promise<ClosureReportDto> {
  const sessions = await tx
    .select()
    .from(s.groupSessions)
    .where(eq(s.groupSessions.groupId, group.id))
    .orderBy(asc(s.groupSessions.startsAt), asc(s.groupSessions.id));
  const [settings] = await tx
    .select()
    .from(s.attendanceSettings)
    .where(eq(s.attendanceSettings.id, 1));
  if (!settings) throw new Error("Attendance settings unavailable");
  const [scheme] = await tx
    .select()
    .from(s.evaluationSchemes)
    .where(eq(s.evaluationSchemes.courseId, course.id));
  const components = await tx
    .select()
    .from(s.evaluationComponents)
    .where(eq(s.evaluationComponents.courseId, course.id))
    .orderBy(asc(s.evaluationComponents.order));
  const grades = await tx
    .select({ grade: s.evaluationGrades, actorName: s.users.name })
    .from(s.evaluationGrades)
    .leftJoin(s.users, eq(s.users.id, s.evaluationGrades.recordedBy))
    .where(eq(s.evaluationGrades.courseId, course.id));
  const roster = await tx
    .select({
      sessionId: s.sessionRoster.sessionId,
      registrationId: s.sessionRoster.registrationId,
      firstName: s.participants.firstName,
      paternalSurname: s.participants.paternalSurname,
      maternalSurname: s.participants.maternalSurname,
    })
    .from(s.sessionRoster)
    .innerJoin(
      s.groupSessions,
      eq(s.groupSessions.id, s.sessionRoster.sessionId),
    )
    .innerJoin(
      s.preRegistrations,
      eq(s.preRegistrations.id, s.sessionRoster.registrationId),
    )
    .innerJoin(
      s.participants,
      eq(s.participants.id, s.preRegistrations.participantId),
    )
    .where(eq(s.groupSessions.groupId, group.id));
  const marks = await tx
    .select({ mark: s.participantAttendance, actorName: s.users.name })
    .from(s.participantAttendance)
    .innerJoin(
      s.groupSessions,
      eq(s.groupSessions.id, s.participantAttendance.sessionId),
    )
    .leftJoin(s.users, eq(s.users.id, s.participantAttendance.markedBy))
    .where(eq(s.groupSessions.groupId, group.id));
  const instructorMarks = await tx
    .select({ mark: s.instructorAttendance, actorName: s.users.name })
    .from(s.instructorAttendance)
    .innerJoin(
      s.groupSessions,
      eq(s.groupSessions.id, s.instructorAttendance.sessionId),
    )
    .leftJoin(s.users, eq(s.users.id, s.instructorAttendance.markedBy))
    .where(eq(s.groupSessions.groupId, group.id));
  const attendanceEvidence = await loadAttendanceGradeEvidence(
    tx,
    course,
    group.id,
    now,
    {
      sessions,
      roster: roster.map((row) => ({ row })),
      marks: marks.map(({ mark }) => ({ row: mark })),
      instructors: instructorMarks.map(({ mark }) => ({ row: mark })),
    },
  );
  for (const { session, participants } of attendanceEvidence.evidence)
    for (const participant of participants) {
      if (
        roster.some(
          (r) =>
            r.sessionId === session.id &&
            r.registrationId === participant.registrationId,
        )
      )
        continue;
      const person = attendanceEvidence.eligibility.find(
        (p) => p.registration.id === participant.registrationId,
      );
      if (person)
        roster.push({
          sessionId: session.id,
          registrationId: participant.registrationId,
          firstName: person.firstName,
          paternalSurname: person.paternalSurname,
          maternalSurname: person.maternalSurname,
        });
    }
  function markDto(
    session: SessionRow,
    mark?: {
      status: "PRESENT" | "ABSENT" | "EXCUSED";
      markedBy: string;
      markedAt: Date;
    },
    actorName?: string | null,
  ): AttendanceMarkDto {
    const status =
      session.cancelledAt && !mark
        ? "PENDING"
        : effectiveAttendance(
            mark?.status ?? null,
            session.startsAt,
            session.administrativeReviewRequired,
            now,
          );
    return {
      status,
      inferred: !mark && status === "ABSENT",
      markedBy: mark?.markedBy ?? null,
      markedByName: actorName ?? null,
      markedAt: mark?.markedAt.toISOString() ?? null,
    };
  }
  const sessionDtos = sessions.map((session) => {
    const instructor = instructorMarks.find(
      (row) => row.mark.sessionId === session.id,
    );
    return {
      id: session.id,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
      cancelledAt: session.cancelledAt?.toISOString() ?? null,
      cancellationReason: session.cancellationReason,
      replacementForSessionId: session.replacementForSessionId,
      administrativeReviewRequired: session.administrativeReviewRequired,
      revision: session.revision,
      instructorAttendance: course.instructorId
        ? markDto(session, instructor?.mark, instructor?.actorName)
        : {
            status: "PENDING" as const,
            inferred: false,
            markedBy: null,
            markedByName: null,
            markedAt: null,
          },
      participants: roster
        .filter((row) => row.sessionId === session.id)
        .map((row) => {
          const mark = marks.find(
            (m) =>
              m.mark.sessionId === session.id &&
              m.mark.registrationId === row.registrationId,
          );
          return {
            registrationId: row.registrationId,
            firstName: row.firstName,
            paternalSurname: row.paternalSurname,
            maternalSurname: row.maternalSurname,
            attendance: markDto(session, mark?.mark, mark?.actorName),
          };
        }),
    };
  });
  const people = (await loadEvaluationRoster(tx, course, now)).filter(
    (person) =>
      person.groupId === group.id && person.membershipStatus === "INSCRITO",
  );
  // One grouped query for the group, under the same close/finance locks.
  // Do not reuse balance: it is price minus payments, not net cash received.
  const ledger = s.registrationLedger;
  const net = sql`case when ${ledger.kind} = 'PAYMENT' then ${ledger.amountCents} else -${ledger.amountCents} end`;
  const financialRows = await tx
    .select({
      registrationId: s.preRegistrations.id,
      category: s.preRegistrations.participantType,
      cashCents: sql<string>`coalesce(sum(${net}) filter (where ${ledger.paymentMethod} = 'CASH'), 0)::text`,
      qrCents: sql<string>`coalesce(sum(${net}) filter (where ${ledger.paymentMethod} = 'QR'), 0)::text`,
      unregisteredCents: sql<string>`coalesce(sum(${net}) filter (where ${ledger.paymentMethod} is null), 0)::text`,
      totalCents: sql<string>`coalesce(sum(${net}), 0)::text`,
    })
    .from(s.preRegistrations)
    .leftJoin(
      ledger,
      and(
        eq(ledger.registrationId, s.preRegistrations.id),
        lte(ledger.recordedAt, now),
      ),
    )
    .where(
      and(
        eq(s.preRegistrations.courseId, course.id),
        eq(s.preRegistrations.groupId, group.id),
      ),
    )
    .groupBy(s.preRegistrations.id, s.preRegistrations.participantType);
  const finances = new Map(
    financialRows.map((row) => [row.registrationId, row]),
  );
  const [instructor] = course.instructorId
    ? await tx
        .select({ name: s.users.name })
        .from(s.users)
        .where(eq(s.users.id, course.instructorId))
    : [];
  return {
    courseId: course.id,
    courseName: course.name,
    groupId: group.id,
    groupName: registrationGroupName(group),
    instructorId: course.instructorId,
    instructorName: instructor?.name ?? null,
    minimumGrade: course.minimumGrade,
    scheme: {
      revision: scheme?.revision ?? 0,
      frozenAt: scheme?.frozenAt?.toISOString() ?? null,
      modality: evaluationModality(components.map((c) => c.type)),
      canEdit: false,
      components: components.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        weight: evaluationDecimal(c.weightHundredths),
        order: c.order,
      })),
    },
    attendanceSettings: {
      consecutiveAbsenceLimit: settings.consecutiveAbsenceLimit,
      revision: settings.revision,
      updatedAt: settings.updatedAt.toISOString(),
    },
    sessions: sessionDtos,
    participants: people
      .sort(
        (a, b) =>
          compareParticipantNames(a, b) ||
          a.participantId.localeCompare(b.participantId),
      )
      .map((person) => {
        const financial = finances.get(person.id);
        if (!financial)
          throw new Error("Closure financial evidence unavailable");
        const personGrades = grades.filter(
          (row) => row.grade.participantId === person.participantId,
        );
        const statuses = sessionDtos
          .filter((session) => !session.cancelledAt)
          .flatMap((session) =>
            session.participants
              .filter((p) => p.registrationId === person.id)
              .map((p) => p.attendance.status),
          );
        const attendance = {
          ...attendanceSummary(statuses, settings.consecutiveAbsenceLimit),
          present: statuses.filter((v) => v === "PRESENT").length,
          absent: statuses.filter((v) => v === "ABSENT").length,
          excused: statuses.filter((v) => v === "EXCUSED").length,
          pending: statuses.filter((v) => v === "PENDING").length,
        };
        const result = evaluationResult(
          components,
          effectiveEvaluationGrades(
            components,
            personGrades.map((g) => g.grade),
            person.id,
            attendanceEvidence,
          ),
          course.minimumGrade,
        );
        return {
          participantId: person.participantId,
          registrationId: person.id,
          groupId: group.id,
          firstName: person.firstName,
          paternalSurname: person.paternalSurname,
          maternalSurname: person.maternalSurname,
          ci: person.ci,
          participantCategory: financial.category,
          receivedPayments: {
            cashCents: financial.cashCents,
            qrCents: financial.qrCents,
            unregisteredCents: financial.unregisteredCents,
            totalCents: financial.totalCents,
          },
          balanceCents: Number(person.balance),
          membershipStatus: person.membershipStatus,
          canGrade: false,
          grades: components.map((component) => {
            const grade = personGrades.find(
              (g) => g.grade.componentId === component.id,
            );
            return {
              componentId: component.id,
              score:
                grade &&
                (component.type !== "ATTENDANCE" ||
                  grade.grade.origin === "MANUAL")
                  ? evaluationDecimal(grade.grade.scoreHundredths)
                  : component.type === "ATTENDANCE" &&
                      attendanceEvidence.score(person.id) !== null
                    ? evaluationDecimal(attendanceEvidence.score(person.id)!)
                    : null,
              revision: grade?.grade.revision ?? 0,
              recordedBy: grade?.grade.recordedBy ?? null,
              recordedByName: grade?.actorName ?? null,
              recordedAt: grade?.grade.recordedAt.toISOString() ?? null,
            };
          }),
          result,
          attendance,
          academicallyPassed: result.passed && attendance.academicallyEligible,
        };
      }),
  };
}
