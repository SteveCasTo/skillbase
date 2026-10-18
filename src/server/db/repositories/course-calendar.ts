import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type {
  AttendanceDatabase,
  AttendanceTransaction,
} from "./attendance-calendar";
import {
  ensureGroupSessions,
  replanFutureGroupSessions,
} from "./attendance-calendar";
import * as s from "@/server/db/schema";
import { planWeekdaySchedule } from "@/domain/courses/weekday-schedule";
import {
  instantToBoliviaCivil,
  boliviaCivilToInstant,
} from "@/domain/courses/bolivia-time";
import { CourseDomainError } from "@/domain/courses/errors";
import { instructorHasConflict } from "./instructor-schedule";

type Course = typeof s.courses.$inferSelect;
type Revision = typeof s.courseTypeRevisions.$inferSelect;

/** Schedule gate + course row precede these child locks on every command path.
 * Readers use exactly the same evidence predicate, without materializing calendars.
 */
export async function courseCalendarState(
  db: AttendanceDatabase | AttendanceTransaction,
  course: Course,
  revision: Revision,
  lock = false,
) {
  const query = db
    .select()
    .from(s.groups)
    .where(eq(s.groups.courseId, course.id))
    .orderBy(asc(s.groups.id));
  const groups = await (lock ? query.for("update") : query);
  const affected = groups.filter((g) => g.status === "PLANNED");
  const ids = affected.map((g) => g.id);
  const sessionsQuery = db
    .select()
    .from(s.groupSessions)
    .where(inArray(s.groupSessions.groupId, ids))
    .orderBy(asc(s.groupSessions.startsAt), asc(s.groupSessions.id));
  const sessions = ids.length
    ? await (lock ? sessionsQuery.for("update") : sessionsQuery)
    : [];
  const sessionIds = sessions.map((session) => session.id);
  const [evidence] = await db
    .select({
      academic: sql<boolean>`exists(select 1 from ${s.evaluationSchemes} where ${s.evaluationSchemes.courseId} = ${course.id} and ${s.evaluationSchemes.frozenAt} is not null)
      or exists(select 1 from ${s.evaluationGrades} where ${s.evaluationGrades.courseId} = ${course.id})
      or exists(select 1 from ${s.evaluationResults} where ${s.evaluationResults.courseId} = ${course.id})
      or exists(select 1 from ${s.academicClosureVersions} where ${s.academicClosureVersions.courseId} = ${course.id})
      or exists(select 1 from ${s.certificates} where ${s.certificates.courseId} = ${course.id})`,
    })
    .from(s.courses)
    .where(eq(s.courses.id, course.id));
  const marks = sessionIds.length
    ? await db
        .select({ id: s.groupSessions.id })
        .from(s.groupSessions)
        .where(
          and(
            inArray(s.groupSessions.id, sessionIds),
            sql`(
    exists(select 1 from ${s.sessionRoster} where ${s.sessionRoster.sessionId} = ${s.groupSessions.id})
    or exists(select 1 from ${s.participantAttendance} where ${s.participantAttendance.sessionId} = ${s.groupSessions.id})
    or exists(select 1 from ${s.instructorAttendance} where ${s.instructorAttendance.sessionId} = ${s.groupSessions.id})
  )`,
          ),
        )
        .limit(1)
    : [];
  // Audit evidence survives corrections/removals. In particular, a hand-written
  // cancellation reason must not impersonate the ordinary bulk-replan contract.
  const events = sessionIds.length
    ? await db
        .select({
          entityId: s.auditEvents.entityId,
          action: s.auditEvents.action,
        })
        .from(s.auditEvents)
        .where(
          and(
            eq(s.auditEvents.entityType, "SESSION"),
            inArray(s.auditEvents.entityId, sessionIds),
          ),
        )
    : [];
  const closed = ids.length
    ? await db
        .select({ id: s.academicGroupStates.groupId })
        .from(s.academicGroupStates)
        .where(
          and(
            inArray(s.academicGroupStates.groupId, ids),
            sql`(${s.academicGroupStates.closed} or ${s.academicGroupStates.lastVersion} > 0)`,
          ),
        )
        .limit(1)
    : [];
  const now = new Date(); // Sample AFTER all command lock waits, never transaction now().
  let ordinary = course.weekdaysMask === 31 && revision.sessionMinutes !== null;
  for (const group of affected) {
    if (
      !ordinary ||
      group.courseTypeRevisionId !== revision.id ||
      group.startsAt <= now
    ) {
      ordinary = false;
      break;
    }
    const actual = sessions.filter((session) => session.groupId === group.id);
    let plan: ReturnType<typeof planWeekdaySchedule>;
    try {
      plan = planWeekdaySchedule({
        startsAt: instantToBoliviaCivil(group.startsAt),
        weekdaysMask: 31,
        totalHours: revision.totalHours,
        sessionMinutes: revision.sessionMinutes!,
      });
    } catch (error) {
      if (!(error instanceof CourseDomainError)) throw error;
      ordinary = false;
      break; // Unverifiable historical patterns lock dates, not content editing.
    }
    if (
      instantToBoliviaCivil(group.startsAt).slice(0, 10) !==
        instantToBoliviaCivil(course.startsAt).slice(0, 10) ||
      group.endsAt.getTime() !== plan.endsAt.getTime()
    )
      ordinary = false;
    const active = actual.filter((session) => !session.cancelledAt);
    if (
      actual.some(
        (session) =>
          session.startsAt <= now ||
          session.administrativeReviewRequired ||
          session.rosterReviewedAt ||
          (session.cancelledAt &&
            !events.some(
              (event) =>
                event.entityId === session.id &&
                event.action === "SESSION_REPLACED_BY_GROUP_SCHEDULE",
            )),
      )
    )
      ordinary = false;
    if (
      actual.length &&
      (active.length !== plan.sessions.length ||
        active.some(
          (session, index) =>
            session.startsAt.getTime() !==
              plan.sessions[index]!.startsAt.getTime() ||
            session.endsAt.getTime() !==
              plan.sessions[index]!.endsAt.getTime() ||
            session.courseTypeRevisionId !== revision.id,
        ))
    )
      ordinary = false;
  }
  if (
    events.some(
      (event) =>
        event.action.includes("ATTENDANCE") ||
        event.action === "SESSION_REPLACEMENT_CREATED" ||
        event.action === "SESSION_CANCELLED",
    )
  )
    ordinary = false;
  return {
    groups,
    affected,
    now,
    canReschedule:
      !evidence?.academic &&
      !marks.length &&
      !closed.length &&
      (!groups.length || ordinary),
  };
}

export async function rescheduleCourseGroups(
  tx: AttendanceTransaction,
  previous: Course,
  next: { startsAt: Date; endsAt: Date; instructorId?: string | null },
  revision: Revision,
  state: Awaited<ReturnType<typeof courseCalendarState>>,
  actorId: string,
) {
  const now = new Date();
  if (!state.canReschedule || previous.startsAt <= now || next.startsAt <= now)
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "El calendario del curso no permite cambiar el inicio.",
      {
        startsAt:
          "El inicio debe ser futuro y el calendario no debe tener actividad ni ajustes individuales.",
      },
    );
  const plans = state.affected.map((group) => {
    const start = boliviaCivilToInstant(
      `${instantToBoliviaCivil(next.startsAt).slice(0, 10)}T${instantToBoliviaCivil(group.startsAt).slice(11)}`,
    );
    const plan = planWeekdaySchedule({
      startsAt: instantToBoliviaCivil(start),
      weekdaysMask: 31,
      totalHours: revision.totalHours,
      sessionMinutes: revision.sessionMinutes!,
    });
    return { group, plan, start };
  });
  const candidates = plans.flatMap(({ plan }) => plan.sessions);
  if (plans.some(({ start }) => start <= now))
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "Todos los grupos deben iniciar en el futuro.",
      {
        startsAt:
          "Selecciona una fecha futura para todos los horarios de grupo.",
      },
    );
  if (
    await instructorHasConflict(tx, previous.id, next.instructorId, candidates)
  )
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "El instructor tiene otro curso en ese horario.",
      { startsAt: "Selecciona un calendario sin conflictos." },
    );
  // All plans/conflicts are checked before writes. Transaction rollback also
  // covers replacement inserts, group revisions, course update and audit.
  for (const { group, plan, start } of plans) {
    await replanFutureGroupSessions(tx, group, start, actorId, now, true);
    await tx
      .update(s.groups)
      .set({
        startsAt: start,
        endsAt: plan.endsAt,
        updatedAt: new Date(
          Math.max(Date.now(), group.updatedAt.getTime() + 1),
        ),
      })
      .where(eq(s.groups.id, group.id));
    await ensureGroupSessions(
      tx,
      { ...group, startsAt: start, endsAt: plan.endsAt },
      now,
      actorId,
    );
    await tx.insert(s.auditEvents).values({
      actorId,
      entityType: "GROUP",
      entityId: group.id,
      action: "GROUP_SCHEDULE_CHANGED",
      metadata: {
        from: group.startsAt.toISOString(),
        to: start.toISOString(),
        oldEndsAt: group.endsAt.toISOString(),
        endsAt: plan.endsAt.toISOString(),
        source: "COURSE_START_CHANGED",
      },
    });
  }
}
