import { and, asc, eq, or } from "drizzle-orm";
import type { InternalUser } from "@/domain/auth/types";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import { planWeekdaySchedule } from "@/domain/courses/weekday-schedule";
import { getAttendanceGroup } from "@/application/attendance/manage-attendance";
import { DrizzleAttendanceRepository } from "@/server/db/repositories/attendance-repository";
import { lockInstructorSchedules } from "@/server/db/repositories/instructor-schedule";
import {
  requireFreshRegistrationActor,
  type RegistrationTransaction,
} from "@/server/db/repositories/registration-support";
import * as s from "@/server/db/schema";
import { renewalPlan, seedId, SEED_OWNER } from "./renew-demo-plan";
import {
  financialDemoPlan,
  financialDemoId,
  FINANCIAL_DEMO_OWNER,
  currentAnchor,
} from "./financial-demo-plan";
import {
  attendanceDemoId,
  ATTENDANCE_DEMO_OWNER,
} from "./attendance-demo-plan";

export const DEMO_CALENDAR_OWNER = "skillbase-demo-calendars-v1";
/** IDs, not slug prefixes or editable names, establish the finite seed scope. */
function registry(now: Date) {
  // Financial IDs are version/key-derived and independent of anchor/settings.
  // Plans enumerate IDs only here; they never supply or rewrite stored dates.
  return [
    ...renewalPlan(now).map((sample) => ({
      owner: SEED_OWNER,
      courseId: sample.course.id,
      markerId: seedId(`audit:${sample.course.id}`),
      groupIds: sample.groups.map((g) => g.id),
    })),
    ...financialDemoPlan(currentAnchor(now), 25).samples.map((sample) => ({
      owner: FINANCIAL_DEMO_OWNER,
      courseId: sample.course.id,
      markerId: financialDemoId(`audit:${sample.key}`),
      groupIds: sample.groups.map((g) => g.id),
    })),
    {
      owner: ATTENDANCE_DEMO_OWNER,
      courseId: attendanceDemoId("course"),
      markerId: attendanceDemoId("course-marker"),
      groupIds: [attendanceDemoId("group:0"), attendanceDemoId("group:1")],
    },
  ];
}
export interface DemoCalendarPlan {
  courseId: string;
  groupId: string;
  seedOwner: string;
  expectedOriginals: number;
  originals: number;
  replacements: number;
  cancelled: number;
  missing: boolean;
}
/** READ ONLY discovery; never invoke lazy loaders in PLAN. Existing calendars
 * are checked but never regenerated, restored, repaired or marked by this seed.
 */
export async function planDemoCalendars(
  tx: RegistrationTransaction,
  now: Date,
): Promise<DemoCalendarPlan[]> {
  const result: DemoCalendarPlan[] = [];
  for (const entry of registry(now)) {
    const [course] = await tx
      .select()
      .from(s.courses)
      .where(eq(s.courses.id, entry.courseId));
    const [marker] = await tx
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, entry.markerId));
    if (!course && !marker) continue;
    if (
      !course ||
      marker?.action !== "DEMO_SEEDED" ||
      marker.entityType !== "COURSE" ||
      marker.entityId !== entry.courseId ||
      marker.metadata.seedOwner !== entry.owner
    )
      throw new Error("Demo calendar course ownership collision");
    const groups = await tx
      .select()
      .from(s.groups)
      .where(eq(s.groups.courseId, course.id))
      .orderBy(asc(s.groups.id));
    if (
      groups.length !== entry.groupIds.length ||
      groups.some((g) => !entry.groupIds.includes(g.id))
    )
      throw new Error("Demo calendar unexpected group ownership");
    for (const group of groups) {
      const [revision] = await tx
        .select()
        .from(s.courseTypeRevisions)
        .where(eq(s.courseTypeRevisions.id, group.courseTypeRevisionId));
      if (
        group.courseTypeRevisionId !== course.courseTypeRevisionId ||
        !revision?.sessionMinutes
      )
        throw new Error("Demo calendar revision unavailable");
      const expected = planWeekdaySchedule({
        startsAt: instantToBoliviaCivil(group.startsAt),
        weekdaysMask: 31,
        totalHours: revision.totalHours,
        sessionMinutes: revision.sessionMinutes,
      });
      const sessions = await tx
        .select()
        .from(s.groupSessions)
        .where(eq(s.groupSessions.groupId, group.id));
      if (!sessions.length) {
        const [previous] = await tx
          .select({ id: s.auditEvents.id })
          .from(s.auditEvents)
          .where(
            or(
              eq(
                s.auditEvents.id,
                financialDemoId(`${DEMO_CALENDAR_OWNER}:${group.id}`),
              ),
              and(
                eq(s.auditEvents.entityId, group.id),
                eq(s.auditEvents.entityType, "GROUP"),
                eq(s.auditEvents.action, "SESSION_CALENDAR_GENERATED"),
              ),
            ),
          );
        if (previous)
          throw new Error(
            "Demo calendar provenance exists without series; no repair allowed",
          );
      }
      const originals = sessions.filter(
        (row) => row.replacementForSessionId === null,
      );
      if (sessions.length && originals.length !== expected.sessionCount)
        throw new Error(
          "Demo calendar partial or foreign original series; manual review required",
        );
      for (const original of originals) {
        const slot =
          original.ordinal === null
            ? undefined
            : expected.sessions[original.ordinal - 1];
        if (
          !slot ||
          original.courseTypeRevisionId !== group.courseTypeRevisionId ||
          original.startsAt.getTime() !== slot.startsAt.getTime() ||
          original.endsAt.getTime() !== slot.endsAt.getTime()
        )
          throw new Error("Demo calendar foreign original interval");
      }
      for (const replacement of sessions.filter(
        (row) => row.replacementForSessionId !== null,
      )) {
        const parent = sessions.find(
          (row) => row.id === replacement.replacementForSessionId,
        );
        if (
          !parent?.cancelledAt ||
          replacement.courseTypeRevisionId !== group.courseTypeRevisionId ||
          replacement.endsAt.getTime() - replacement.startsAt.getTime() !==
            revision.sessionMinutes * 60000
        )
          throw new Error("Demo calendar foreign replacement linkage");
      }
      result.push({
        courseId: course.id,
        groupId: group.id,
        seedOwner: entry.owner,
        expectedOriginals: expected.sessionCount,
        originals: originals.length,
        replacements: sessions.length - originals.length,
        cancelled: sessions.filter((row) => row.cancelledAt !== null).length,
        missing: sessions.length === 0,
      });
    }
  }
  return result;
}
export async function completeDemoCalendars(
  tx: RegistrationTransaction,
  actor: InternalUser,
  apply: boolean,
  now = new Date(),
  preview?: (plan: readonly DemoCalendarPlan[]) => void,
): Promise<DemoCalendarPlan[]> {
  if (apply) {
    await lockInstructorSchedules(tx);
    await requireFreshRegistrationActor(tx, actor.id);
  }
  const plan = await planDemoCalendars(tx, now);
  preview?.(plan);
  if (!apply) return plan;
  const repository = new DrizzleAttendanceRepository(tx, () => now);
  for (const row of plan.filter((row) => row.missing)) {
    await getAttendanceGroup(repository, actor, row.courseId, row.groupId);
    // Auditable provenance for this new materialization only. Existing series
    // receive no new marker/audit and their cancelled recovery families stay put.
    await tx.insert(s.auditEvents).values({
      id: financialDemoId(`${DEMO_CALENDAR_OWNER}:${row.groupId}`),
      actorId: actor.id,
      entityType: "GROUP",
      entityId: row.groupId,
      action: "DEMO_SEEDED",
      metadata: {
        seedOwner: DEMO_CALENDAR_OWNER,
        parentOwner: row.seedOwner,
        originalSessions: row.expectedOriginals,
      },
    });
  }
  if (plan.some((row) => row.missing)) {
    const after = await planDemoCalendars(tx, now);
    if (after.some((row) => row.missing))
      throw new Error("Demo calendar materialization incomplete");
    return after;
  }
  return plan;
}
