import { and, eq, ne, sql, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { instructorSchedulesOverlap } from "@/domain/instructors/schedule";
import { CourseDomainError } from "@/domain/courses/errors";

type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Gate precedes discovery and all row locks. Existing format writes also take this gate.
 * Sorted instructor locks precede the course row; no stale assignment can escape discovery.
 */
export async function lockInstructorSchedules(
  tx: Transaction,
  courseId?: string,
  nextId?: string | null,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(20260915, 3)`);
  const [previous] = courseId
    ? await tx
        .select({ instructorId: schema.courses.instructorId })
        .from(schema.courses)
        .where(eq(schema.courses.id, courseId))
    : [];
  const ids = [
    ...new Set(
      [previous?.instructorId, nextId].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  ].sort();
  for (const id of ids)
    await tx.execute(
      sql`select pg_advisory_xact_lock(20261004, hashtext(${id}))`,
    );
}

export async function assertActiveInstructor(
  tx: Transaction,
  id: string | null | undefined,
  required = false,
): Promise<void> {
  if (!id) {
    if (!required) return;
  } else {
    const [found] = await tx
      .select({ id: schema.instructorProfiles.id })
      .from(schema.instructorProfiles)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.instructorProfiles.id),
      )
      .innerJoin(
        schema.userRoles,
        and(
          eq(schema.userRoles.userId, schema.users.id),
          eq(schema.userRoles.roleCode, "INSTRUCTOR"),
        ),
      )
      .where(
        and(
          eq(schema.instructorProfiles.id, id),
          eq(schema.users.status, "ACTIVE"),
        ),
      );
    if (found) return;
  }
  throw new CourseDomainError(
    "VALIDATION_FAILED",
    "Selecciona un instructor activo registrado.",
    {
      instructorId:
        "Selecciona un instructor activo registrado antes de publicar.",
    },
  );
}

export async function instructorHasConflict(
  tx: Transaction,
  courseId: string,
  instructorId: string | null | undefined,
  candidates?: readonly { startsAt: Date; endsAt: Date }[],
): Promise<boolean> {
  if (!instructorId) return false;
  const ownGroups = await tx
    .select()
    .from(schema.groups)
    .where(
      and(
        eq(schema.groups.courseId, courseId),
        eq(schema.groups.status, "PLANNED"),
      ),
    );
  const ownSessions = ownGroups.length
    ? await tx
        .select()
        .from(schema.groupSessions)
        .where(
          inArray(
            schema.groupSessions.groupId,
            ownGroups.map((g) => g.id),
          ),
        )
    : [];
  const own =
    candidates ??
    ownGroups.flatMap<
      | typeof schema.groups.$inferSelect
      | typeof schema.groupSessions.$inferSelect
    >((g) => {
      const actual = ownSessions.filter((r) => r.groupId === g.id);
      return actual.length ? actual.filter((r) => !r.cancelledAt) : [g];
    });
  const others = await tx
    .select({
      id: schema.groups.id,
      startsAt: schema.groups.startsAt,
      endsAt: schema.groups.endsAt,
    })
    .from(schema.groups)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.groups.courseId))
    .where(
      and(
        eq(schema.courses.instructorId, instructorId),
        ne(schema.courses.id, courseId),
        eq(schema.groups.status, "PLANNED"),
      ),
    );
  const otherSessions = others.length
    ? await tx
        .select()
        .from(schema.groupSessions)
        .where(
          inArray(
            schema.groupSessions.groupId,
            others.map((g) => g.id),
          ),
        )
    : [];
  const operative = others.flatMap((g) => {
    const actual = otherSessions.filter((r) => r.groupId === g.id);
    return actual.length ? actual.filter((r) => !r.cancelledAt) : [g];
  });
  return own.some((a) =>
    operative.some((b) => {
      // Actual sessions may be weekends; recurrence must retain its weekday constraint.
      const aActual = "ordinal" in a,
        bActual = "ordinal" in b;
      return aActual && bActual
        ? a.startsAt < b.endsAt && b.startsAt < a.endsAt
        : instructorSchedulesOverlap(a, b);
    }),
  );
}

export async function assertInstructorSchedule(
  tx: Transaction,
  courseId: string,
  instructorId: string | null | undefined,
): Promise<void> {
  if (await instructorHasConflict(tx, courseId, instructorId))
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "El instructor tiene otro curso en ese horario.",
      {
        instructorId: "Revisa los horarios de todos los grupos del instructor.",
      },
    );
}
