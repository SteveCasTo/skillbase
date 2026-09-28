/** One-off, local-only reconciliation. Never call the ordinary insert-only seed here. */
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";

import {
  boliviaCivilToInstant,
  instantToBoliviaCivil,
} from "@/domain/courses/bolivia-time";
import {
  GROUP_SCHEDULE,
  planCourseDates,
} from "@/domain/courses/weekday-schedule";
import { groupPlan, overlaps } from "@/domain/groups/rules";
import { createDatabase } from "@/server/db/client";
import {
  auditEvents,
  courses,
  courseTypeRevisions,
  groups,
  userRoles,
  users,
} from "@/server/db/schema";
import { getLocalSupabaseEnvironment } from "./supabase-local-env";

export const RECONCILIATION = [
  {
    slug: "demo-programacion-web",
    date: "2026-11-16",
    registration: "2026-09-28",
    groups: [
      { time: "09:00", capacity: 20 },
      { time: "18:00", capacity: 15 },
    ],
  },
  {
    slug: "demo-analisis-de-datos",
    date: "2026-11-23",
    registration: "2026-10-01",
    groups: [{ time: "09:00", capacity: 25 }],
  },
  {
    slug: "demo-diseno-de-interfaces",
    date: "2026-11-30",
    registration: "2026-10-05",
    groups: [{ time: "14:00", capacity: 18 }],
  },
  {
    slug: "demo-ciberseguridad-basica",
    date: "2026-12-07",
    registration: "2026-10-12",
    groups: [{ time: "18:00", capacity: 22 }],
  },
  {
    slug: "demo-gestion-de-proyectos",
    date: "2026-12-14",
    registration: null,
    groups: [{ time: "09:00", capacity: 16 }],
  },
] as const;

type Course = typeof courses.$inferSelect;
type Revision = typeof courseTypeRevisions.$inferSelect;
type Group = Pick<
  typeof groups.$inferSelect,
  | "id"
  | "courseId"
  | "courseTypeRevisionId"
  | "capacity"
  | "status"
  | "startsAt"
  | "endsAt"
  | "createdAt"
  | "updatedAt"
>;

export function planReconciliation(
  course: Course,
  revision: Revision,
  now: Date,
) {
  const sample = RECONCILIATION.find((item) => item.slug === course.slug);
  if (!sample) throw new Error("Course is not in the five-slug allowlist");
  if (course.status === "ARCHIVED")
    throw new Error(
      `Archived demo course requires manual review: ${course.slug}`,
    );
  if (
    revision.id !== course.courseTypeRevisionId ||
    revision.sessionMinutes === null
  )
    throw new Error(
      `Referenced revision lacks session minutes: ${course.slug}`,
    );
  const dates = planCourseDates({
    startDate: sample.date,
    weekdaysMask: 31,
    totalHours: revision.totalHours,
    sessionMinutes: revision.sessionMinutes,
  });
  if (dates.startsAt <= now)
    throw new Error(`Planned start is no longer forthcoming: ${course.slug}`);
  const registrationStartAt = sample.registration
    ? boliviaCivilToInstant(`${sample.registration}T00:00`)
    : null;
  // Registration closes a week before the first class (exclusive boundary).
  const registrationEndAt = sample.registration
    ? boliviaCivilToInstant(
        `${new Date(Date.parse(`${sample.date}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10)}T00:00`,
      )
    : null;
  if (
    registrationStartAt &&
    registrationEndAt &&
    !(
      registrationStartAt < registrationEndAt &&
      registrationEndAt < dates.startsAt
    )
  )
    throw new Error(`Invalid preregistration window: ${course.slug}`);
  const plannedGroups = sample.groups.map(({ time, capacity }) => ({
    capacity,
    ...groupPlan({ ...dates, weekdaysMask: 31 }, revision, time),
  }));
  if (
    plannedGroups.some((group, index) =>
      plannedGroups
        .slice(index + 1)
        .some((other) =>
          overlaps(group.startsAt, group.endsAt, other.startsAt, other.endsAt),
        ),
    )
  )
    throw new Error(`Overlapping groups: ${course.slug}`);
  return {
    changes: {
      schedule: GROUP_SCHEDULE,
      weekdaysMask: 31,
      startsAt: dates.startsAt,
      endsAt: dates.endsAt,
      registrationStartAt,
      registrationEndAt,
    },
    groups: plannedGroups,
  };
}

function sameDate(a: Date | null, b: Date | null) {
  return a?.getTime() === b?.getTime();
}

export function reconcileState(
  course: Course,
  existing: readonly Group[],
  planned: ReturnType<typeof planReconciliation>,
): "pending" | "applied" {
  if (existing.length === 0) return "pending";
  const matches =
    course.schedule === planned.changes.schedule &&
    course.weekdaysMask === 31 &&
    sameDate(course.startsAt, planned.changes.startsAt) &&
    sameDate(course.endsAt, planned.changes.endsAt) &&
    sameDate(course.registrationStartAt, planned.changes.registrationStartAt) &&
    sameDate(course.registrationEndAt, planned.changes.registrationEndAt) &&
    existing.length === planned.groups.length &&
    existing.every((group, index) => {
      const target = planned.groups[index];
      return (
        target &&
        group.status === "PLANNED" &&
        group.courseTypeRevisionId === course.courseTypeRevisionId &&
        group.capacity === target.capacity &&
        sameDate(group.startsAt, target.startsAt) &&
        sameDate(group.endsAt, target.endsAt)
      );
    });
  if (!matches)
    throw new Error(
      `Existing groups or partial reconciliation on ${course.slug}; aborting without changes`,
    );
  return "applied";
}

function assertLocalDatabase(configuredUrl: string, localUrl: string) {
  const configured = new URL(configuredUrl);
  const local = new URL(localUrl);
  if (
    configured.protocol !== "postgresql:" &&
    configured.protocol !== "postgres:"
  )
    throw new Error("Expected PostgreSQL");
  if (
    configured.hostname !== "127.0.0.1" ||
    configured.host !== local.host ||
    configured.pathname !== local.pathname ||
    configured.username !== local.username ||
    configured.password !== local.password
  )
    throw new Error(
      "Reconciliation accepts only the running local Supabase DB",
    );
}

export async function runReconciliation(
  connectionString: string,
  options: { apply: boolean; actorId?: string; now?: Date; localUrl: string },
) {
  assertLocalDatabase(connectionString, options.localUrl);
  if (options.apply && !options.actorId)
    throw new Error(
      "--apply requires --actor-id of an active local ADMIN user",
    );
  const database = createDatabase(connectionString, { max: 1 });
  try {
    return await database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(20260915, 3)`);
      await tx.execute(sql`select pg_advisory_xact_lock(20260915, 1)`);
      const rows = await tx
        .select()
        .from(courses)
        .where(
          inArray(
            courses.slug,
            RECONCILIATION.map((item) => item.slug),
          ),
        )
        .orderBy(courses.slug)
        .for("update");
      if (rows.length !== 5 || new Set(rows.map((row) => row.slug)).size !== 5)
        throw new Error(
          "Expected exactly five existing allowlisted demo courses; seed missing slugs separately before previewing again",
        );
      const revisions = await tx
        .select()
        .from(courseTypeRevisions)
        .where(
          inArray(
            courseTypeRevisions.id,
            rows.map((row) => row.courseTypeRevisionId),
          ),
        );
      const existing = await tx
        .select({
          id: groups.id,
          courseId: groups.courseId,
          courseTypeRevisionId: groups.courseTypeRevisionId,
          capacity: groups.capacity,
          status: groups.status,
          startsAt: groups.startsAt,
          endsAt: groups.endsAt,
          createdAt: groups.createdAt,
          updatedAt: groups.updatedAt,
        })
        .from(groups)
        .where(
          inArray(
            groups.courseId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(groups.startsAt, groups.id);
      const plans = rows.map((course) => {
        const revision = revisions.find(
          (row) => row.id === course.courseTypeRevisionId,
        );
        if (!revision) throw new Error(`Missing revision for ${course.slug}`);
        const plan = planReconciliation(
          course,
          revision,
          options.now ?? new Date(),
        );
        const courseGroups = existing.filter(
          (group) => group.courseId === course.id,
        );
        return {
          course,
          revision,
          plan,
          state: reconcileState(course, courseGroups, plan),
        };
      });
      // Do not quietly write part of a five-course operation.
      if (
        plans.some((item) => item.state === "applied") &&
        plans.some((item) => item.state === "pending")
      )
        throw new Error("Mixed already-applied and pending courses; aborting");
      const actor = options.actorId ?? null;
      if (actor) {
        const [admin] = await tx
          .select({ id: users.id })
          .from(users)
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .where(
            and(
              eq(users.id, actor),
              eq(users.status, "ACTIVE"),
              eq(userRoles.roleCode, "ADMIN"),
            ),
          );
        if (!admin)
          throw new Error("--actor-id must be an active local ADMIN user");
      }
      const preview = plans.map(({ course, revision, plan, state }) => ({
        slug: course.slug,
        id: course.id,
        state,
        status: course.status,
        revisionId: revision.id,
        sessionMinutes: revision.sessionMinutes,
        previous: {
          schedule: course.schedule,
          weekdaysMask: course.weekdaysMask,
          startsAt: course.startsAt,
          endsAt: course.endsAt,
          registrationStartAt: course.registrationStartAt,
          registrationEndAt: course.registrationEndAt,
        },
        next: plan.changes,
        groups: plan.groups.map((group) => ({
          capacity: group.capacity,
          startsAt: group.startsAt,
          endsAt: group.endsAt,
        })),
      }));
      if (!options.apply)
        return { preview, backup: null, applied: false, actor };

      // Fail before creating a backup when migration 0009 is not present.
      await tx
        .select({ publishedAt: groups.publishedAt })
        .from(groups)
        .limit(1);
      if (plans.every((item) => item.state === "applied")) {
        const exposure = await tx
          .select({
            courseId: groups.courseId,
            publishedAt: groups.publishedAt,
          })
          .from(groups)
          .where(
            inArray(
              groups.courseId,
              rows.map((row) => row.id),
            ),
          );
        if (
          exposure.some(
            (group) =>
              (group.publishedAt !== null) !==
              (rows.find((row) => row.id === group.courseId)?.status ===
                "PUBLISHED"),
          )
        )
          throw new Error(
            "Existing demo group publication history differs from course status; manual review required",
          );
        return { preview, backup: null, applied: false, actor };
      }
      if (!actor) throw new Error("--apply requires an active ADMIN actor");

      // Full rows, not only edited columns. Snapshot while holding the row locks and before any write.
      const previousAudits = await tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityType, "COURSE"),
            inArray(
              auditEvents.entityId,
              rows.map((row) => row.id),
            ),
          ),
        );
      const directory = mkdtempSync(
        join(tmpdir(), "skillbase-demo-reconcile-"),
      );
      chmodSync(directory, 0o700);
      if (
        resolve(directory)
          .toLowerCase()
          .startsWith(
            resolve(import.meta.dir, "..").toLowerCase() +
              (process.platform === "win32" ? "\\" : "/"),
          )
      )
        throw new Error("Backup must be outside the repository");
      const backup = join(directory, "before.json");
      writeFileSync(
        backup,
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            courses: rows,
            revisions,
            groups: existing,
            auditEvents: previousAudits,
          },
          null,
          2,
        ),
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      for (const { course, plan } of plans) {
        const updated = await tx
          .update(courses)
          .set({ ...plan.changes, updatedAt: new Date() })
          .where(
            and(
              eq(courses.id, course.id),
              eq(courses.updatedAt, course.updatedAt),
            ),
          )
          .returning({ id: courses.id });
        if (updated.length !== 1)
          throw new Error(
            `Concurrent change to ${course.slug}; transaction rolled back`,
          );
        const publishedAt = course.status === "PUBLISHED" ? new Date() : null;
        const createdGroups = await tx
          .insert(groups)
          .values(
            plan.groups.map((group) => ({
              courseId: course.id,
              courseTypeRevisionId: course.courseTypeRevisionId,
              capacity: group.capacity,
              publishedAt,
              startsAt: group.startsAt,
              endsAt: group.endsAt,
            })),
          )
          .returning({
            id: groups.id,
            capacity: groups.capacity,
            startsAt: groups.startsAt,
          });
        if (createdGroups.length !== plan.groups.length)
          throw new Error(`Incomplete group insertion for ${course.slug}`);
        await tx.insert(auditEvents).values([
          {
            actorId: actor,
            action: "DEMO_COURSE_RECONCILED",
            entityType: "COURSE",
            entityId: course.id,
            metadata: {
              slug: course.slug,
              backup,
              groupsCreated: createdGroups.length,
            },
          },
          ...createdGroups.map((group) => ({
            actorId: actor,
            action: "GROUP_CREATED",
            entityType: "GROUP",
            entityId: group.id,
            metadata: {
              capacity: group.capacity,
              startTime: instantToBoliviaCivil(group.startsAt).slice(11),
              demoReconciliation: true,
            },
          })),
        ]);
      }
      return { preview, backup, applied: true, actor };
    });
  } finally {
    await database.close();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const actorIndex = args.indexOf("--actor-id");
  if (
    args.length !== Number(apply) + (actorIndex === -1 ? 0 : 2) ||
    (apply && actorIndex === -1) ||
    (actorIndex !== -1 &&
      !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/iu.test(
        args[actorIndex + 1] ?? "",
      )) ||
    args.some(
      (arg, index) =>
        arg !== "--apply" && arg !== "--actor-id" && index !== actorIndex + 1,
    )
  )
    throw new Error(
      "Usage: bun scripts/reconcile-demo-courses.ts [--apply --actor-id UUID]",
    );
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const result = await runReconciliation(url, {
    apply,
    ...(actorIndex === -1 ? {} : { actorId: args[actorIndex + 1] }),
    localUrl: getLocalSupabaseEnvironment().databaseUrl,
  });
  console.info(JSON.stringify(result.preview, null, 2));
  console.info(
    result.applied
      ? `Applied. Backup: ${result.backup}`
      : "Preview only / already applied; no writes.",
  );
}
