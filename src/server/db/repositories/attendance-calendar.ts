import { and, asc, eq, isNull, or, sql, lte, gt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { planWeekdaySchedule } from "@/domain/courses/weekday-schedule";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import {
  AttendanceError,
  civilDay,
  civilDayEndExclusive,
  enrollmentActivatedAt,
  intervalsOverlap,
} from "@/domain/attendance/rules";
import { instructorSchedulesOverlap } from "@/domain/instructors/schedule";
export type AttendanceDatabase = PostgresJsDatabase<typeof schema>;
export type AttendanceTransaction = Parameters<
  Parameters<AttendanceDatabase["transaction"]>[0]
>[0];
export type SessionRow = typeof schema.groupSessions.$inferSelect;

/** Caller owns schedule gate and course lock. Unique ordinals make backfill repeatable. */
export async function ensureGroupSessions(
  tx: AttendanceTransaction,
  group: typeof schema.groups.$inferSelect,
  now: Date,
  actorId: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: schema.groupSessions.id })
    .from(schema.groupSessions)
    .where(eq(schema.groupSessions.groupId, group.id))
    .limit(1);
  if (existing) return;
  const [revision] = await tx
    .select()
    .from(schema.courseTypeRevisions)
    .where(eq(schema.courseTypeRevisions.id, group.courseTypeRevisionId));
  if (!revision?.sessionMinutes)
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "El formato histórico no tiene duración de sesión verificable.",
    );
  const plan = planWeekdaySchedule({
    startsAt: instantToBoliviaCivil(group.startsAt),
    weekdaysMask: 31,
    totalHours: revision.totalHours,
    sessionMinutes: revision.sessionMinutes,
  });
  await tx
    .insert(schema.groupSessions)
    .values(
      plan.sessions.map((session, index) => ({
        ...session,
        groupId: group.id,
        courseTypeRevisionId: group.courseTypeRevisionId,
        ordinal: index + 1,
        administrativeReviewRequired:
          civilDay(session.startsAt) < civilDay(now),
        ...(group.status === "CANCELLED" && session.endsAt > now
          ? {
              cancelledAt: now,
              cancelledBy: actorId,
              cancellationReason: "Calendario generado para grupo ya cancelado",
            }
          : {}),
      })),
    )
    .onConflictDoNothing();
  await tx.insert(schema.auditEvents).values({
    actorId,
    entityType: "GROUP",
    entityId: group.id,
    action: "SESSION_CALENDAR_GENERATED",
    metadata: { sessionCount: plan.sessionCount, historicalReview: true },
  });
}

/** Only immutable settlement-recording chronology and cancellation instants are considered.
 * Transfers are already forbidden once the official course starts. No effectiveDate backfill.
 */
export async function loadGroupEligibility(
  tx: AttendanceTransaction,
  groupId: string,
  officialStart: Date,
  now: Date,
) {
  const registrations = await tx
    .select({
      registration: {
        id: schema.preRegistrations.id,
        state: schema.preRegistrations.state,
        createdAt: schema.preRegistrations.createdAt,
        cancelledAt: schema.preRegistrations.cancelledAt,
        totalPriceCents: schema.preRegistrations.totalPriceCents,
      },
      firstName: schema.participants.firstName,
      lastName: schema.participants.lastName,
    })
    .from(schema.preRegistrations)
    .innerJoin(
      schema.participants,
      eq(schema.participants.id, schema.preRegistrations.participantId),
    )
    .where(
      and(
        eq(schema.preRegistrations.groupId, groupId),
        lte(schema.preRegistrations.createdAt, now),
      ),
    );
  if (!registrations.length) return [];
  const payments = await tx
    .select({
      registrationId: schema.registrationLedger.registrationId,
      amountCents: schema.registrationLedger.amountCents,
      recordedAt: schema.registrationLedger.recordedAt,
    })
    .from(schema.registrationLedger)
    .innerJoin(
      schema.preRegistrations,
      eq(schema.preRegistrations.id, schema.registrationLedger.registrationId),
    )
    .where(
      and(
        eq(schema.preRegistrations.groupId, groupId),
        eq(schema.registrationLedger.kind, "PAYMENT"),
        lte(schema.registrationLedger.recordedAt, now),
      ),
    )
    .orderBy(
      asc(schema.registrationLedger.recordedAt),
      asc(schema.registrationLedger.id),
    );
  return registrations.map((row) => {
    const r = row.registration;
    const activatedAt = enrollmentActivatedAt(
      r.createdAt,
      officialStart,
      Number(r.totalPriceCents),
      payments
        .filter((p) => p.registrationId === r.id)
        .map((p) => ({ ...p, amountCents: Number(p.amountCents) })),
    );
    return { ...row, activatedAt };
  });
}
type GroupEligibility = Awaited<ReturnType<typeof loadGroupEligibility>>;
export async function eligibleSessionRegistrations(
  tx: AttendanceTransaction,
  groupId: string,
  officialStart: Date,
  session: SessionRow,
  now: Date,
  source?: GroupEligibility,
) {
  const horizon = new Date(
    Math.min(
      civilDayEndExclusive(session.startsAt).getTime() - 1,
      now.getTime(),
    ),
  );
  const eligible =
    source ?? (await loadGroupEligibility(tx, groupId, officialStart, now));
  return eligible.filter(
    ({ registration: r, activatedAt }) =>
      activatedAt !== null &&
      activatedAt <= horizon &&
      (!r.cancelledAt ||
        (r.cancelledAt > activatedAt &&
          civilDay(r.cancelledAt) >= civilDay(session.startsAt))),
  );
}
export async function materializeSessionRoster(
  tx: AttendanceTransaction,
  groupId: string,
  officialStart: Date,
  session: SessionRow,
  now: Date,
  source?: GroupEligibility,
): Promise<void> {
  if (
    session.cancelledAt ||
    session.administrativeReviewRequired ||
    session.rosterReviewedAt ||
    civilDay(session.startsAt) > civilDay(now)
  )
    return;
  const eligible = await eligibleSessionRegistrations(
    tx,
    groupId,
    officialStart,
    session,
    now,
    source,
  );
  if (eligible.length)
    await tx
      .insert(schema.sessionRoster)
      .values(
        eligible.map(({ registration }) => ({
          sessionId: session.id,
          registrationId: registration.id,
          establishedAt: now,
        })),
      )
      .onConflictDoNothing();
}

/** Actual materialized calendars replace recurrence, so cancelled intervals really release time.
 * Unmaterialized groups still reserve their planned weekday recurrence.
 */
export async function assertSessionIntervalFree(
  tx: AttendanceTransaction,
  courseId: string,
  groupId: string,
  instructorId: string | null,
  candidate: { startsAt: Date; endsAt: Date },
  exceptSessionId?: string,
): Promise<void> {
  const groups = await tx
    .select({ group: schema.groups, instructorId: schema.courses.instructorId })
    .from(schema.groups)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.groups.courseId))
    .where(
      and(
        eq(schema.groups.status, "PLANNED"),
        or(
          eq(schema.groups.courseId, courseId),
          instructorId
            ? eq(schema.courses.instructorId, instructorId)
            : undefined,
        ),
      ),
    );
  const groupIds = new Set(groups.map(({ group }) => group.id));
  const sessions = await tx
    .select()
    .from(schema.groupSessions)
    .where(
      sql`${schema.groupSessions.groupId} in (select ${schema.groups.id} from ${schema.groups} join ${schema.courses} on ${schema.courses.id} = ${schema.groups.courseId} where ${schema.groups.status} = 'PLANNED' and (${schema.groups.courseId} = ${courseId} or ${schema.courses.instructorId} = ${instructorId}))`,
    );
  for (const { group } of groups) {
    if (!groupIds.has(group.id)) continue;
    const actual = sessions.filter((s) => s.groupId === group.id);
    const conflict = actual.length
      ? actual.some(
          (s) =>
            s.id !== exceptSessionId &&
            !s.cancelledAt &&
            intervalsOverlap(candidate, s),
        )
      : instructorSchedulesOverlap(candidate, group);
    if (conflict)
      throw new AttendanceError(
        "SCHEDULE_CONFLICT",
        group.id === groupId
          ? "El grupo tiene una sesión en ese horario."
          : "El instructor u otro grupo del curso ocupa ese horario.",
        { startsAt: "Selecciona un intervalo libre." },
      );
  }
}

export async function cancelFutureGroupSessions(
  tx: AttendanceTransaction,
  groupId: string,
  actorId: string,
  now: Date,
): Promise<void> {
  const rows = await tx
    .update(schema.groupSessions)
    .set({
      cancelledAt: now,
      cancelledBy: actorId,
      cancellationReason: "Grupo cancelado",
      revision: sql`${schema.groupSessions.revision} + 1`,
    })
    .where(
      and(
        eq(schema.groupSessions.groupId, groupId),
        isNull(schema.groupSessions.cancelledAt),
        gt(schema.groupSessions.endsAt, now),
      ),
    )
    .returning({ id: schema.groupSessions.id });
  if (rows.length)
    await tx.insert(schema.auditEvents).values(
      rows.map((row) => ({
        actorId,
        entityType: "SESSION",
        entityId: row.id,
        action: "SESSION_CANCELLED",
        metadata: { reason: "GROUP_CANCELLED" },
      })),
    );
}

/** An explicit pre-start group schedule edit keeps the old calendar as cancelled
 * evidence and creates a linked replacement per original; it never rewrites timestamps.
 */
export async function replanFutureGroupSessions(
  tx: AttendanceTransaction,
  group: typeof schema.groups.$inferSelect,
  startsAt: Date,
  actorId: string,
  now: Date,
): Promise<void> {
  const current = await tx
    .select()
    .from(schema.groupSessions)
    .where(
      and(
        eq(schema.groupSessions.groupId, group.id),
        isNull(schema.groupSessions.cancelledAt),
      ),
    )
    .orderBy(asc(schema.groupSessions.startsAt));
  if (!current.length) return;
  if (current.some((row) => civilDay(row.startsAt) <= civilDay(now)))
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "El calendario ya comenzó o tiene ajustes. Reprograma sesiones individuales.",
    );
  const [revision] = await tx
    .select()
    .from(schema.courseTypeRevisions)
    .where(eq(schema.courseTypeRevisions.id, group.courseTypeRevisionId));
  if (!revision?.sessionMinutes)
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "La duración de sesión no está disponible.",
    );
  const plan = planWeekdaySchedule({
    startsAt: instantToBoliviaCivil(startsAt),
    weekdaysMask: 31,
    totalHours: revision.totalHours,
    sessionMinutes: revision.sessionMinutes,
  });
  if (plan.sessions.length !== current.length)
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "La cantidad de sesiones debe conservarse.",
    );
  await tx
    .update(schema.groupSessions)
    .set({
      cancelledAt: now,
      cancelledBy: actorId,
      cancellationReason: "Cambio explícito de horario de grupo",
      revision: sql`${schema.groupSessions.revision} + 1`,
    })
    .where(
      and(
        eq(schema.groupSessions.groupId, group.id),
        isNull(schema.groupSessions.cancelledAt),
      ),
    );
  await tx.insert(schema.groupSessions).values(
    plan.sessions.map((interval, index) => ({
      ...interval,
      groupId: group.id,
      courseTypeRevisionId: group.courseTypeRevisionId,
      replacementForSessionId: current[index]!.id,
    })),
  );
  await tx.insert(schema.auditEvents).values(
    current.map((row) => ({
      actorId,
      entityType: "SESSION",
      entityId: row.id,
      action: "SESSION_REPLACED_BY_GROUP_SCHEDULE",
      metadata: { startsAt: row.startsAt.toISOString() },
    })),
  );
}
