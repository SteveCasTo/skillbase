import { and, asc, eq, ne } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { GroupRepository } from "@/application/groups/group-repository";
import {
  assertCapacity,
  GroupError,
  groupPlan,
  overlaps,
} from "@/domain/groups/rules";
import * as schema from "@/server/db/schema";

type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Row = typeof schema.groups.$inferSelect;

function nextVersion(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

export class DrizzleGroupRepository implements GroupRepository {
  constructor(private readonly db: Database) {}

  async list(courseId: string): Promise<readonly Row[]> {
    return this.db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.courseId, courseId))
      .orderBy(asc(schema.groups.createdAt), asc(schema.groups.id));
  }

  private async lockedCourse(
    tx: Transaction,
    id: string,
    requirePublished = true,
  ) {
    const [course] = await tx
      .select()
      .from(schema.courses)
      .where(eq(schema.courses.id, id))
      .for("update");
    if (
      !course ||
      (requirePublished && course.status !== "PUBLISHED") ||
      course.weekdaysMask !== 31
    )
      throw new GroupError(
        "COURSE_UNAVAILABLE",
        "Solo cursos publicados y planificados admiten grupos.",
      );
    const [revision] = await tx
      .select()
      .from(schema.courseTypeRevisions)
      .where(eq(schema.courseTypeRevisions.id, course.courseTypeRevisionId));
    if (!revision || revision.sessionMinutes === null)
      throw new GroupError(
        "COURSE_UNAVAILABLE",
        "El formato no tiene duración de sesión conocida.",
      );
    return { course, revision };
  }

  private async assertFree(
    tx: Transaction,
    courseId: string,
    startsAt: Date,
    endsAt: Date,
    except?: string,
  ) {
    const existing = await tx
      .select()
      .from(schema.groups)
      .where(
        and(
          eq(schema.groups.courseId, courseId),
          eq(schema.groups.status, "PLANNED"),
          except ? ne(schema.groups.id, except) : undefined,
        ),
      );
    if (
      existing.some((row) =>
        overlaps(startsAt, endsAt, row.startsAt, row.endsAt),
      )
    )
      throw new GroupError(
        "SCHEDULE_CONFLICT",
        "Otro grupo del curso ocupa ese horario.",
      );
  }

  private async audit(
    tx: Transaction,
    actorId: string,
    row: Row,
    action: string,
    metadata: Record<string, string | number | boolean | null> = {},
  ) {
    await tx.insert(schema.auditEvents).values({
      actorId,
      entityType: "GROUP",
      entityId: row.id,
      action,
      metadata,
    });
  }

  async create(
    courseId: string,
    startTime: string,
    capacity: number,
    actorId: string,
  ): Promise<Row> {
    assertCapacity(capacity);
    return this.db.transaction(async (tx) => {
      // Serialize all creates and updates of this course before reading competing schedules.
      const { course, revision } = await this.lockedCourse(tx, courseId);
      const plan = groupPlan(course, revision, startTime);
      await this.assertFree(tx, courseId, plan.startsAt, plan.endsAt);
      const [row] = await tx
        .insert(schema.groups)
        .values({
          courseId,
          courseTypeRevisionId: revision.id,
          capacity,
          startsAt: plan.startsAt,
          endsAt: plan.endsAt,
        })
        .returning();
      if (!row) throw new Error("Group insert failed");
      await this.audit(tx, actorId, row, "GROUP_CREATED", {
        capacity,
        startTime,
      });
      return row;
    });
  }

  private async mutate(
    id: string,
    actorId: string,
    expected: Date,
    operation: "schedule" | "capacity" | "cancel",
    value?: string | number,
  ): Promise<Row> {
    return this.db.transaction(async (tx) => {
      // Discover the parent without locking the child; re-read after locking parent.
      const [reference] = await tx
        .select({ courseId: schema.groups.courseId })
        .from(schema.groups)
        .where(eq(schema.groups.id, id));
      if (!reference)
        throw new GroupError("GROUP_NOT_FOUND", "El grupo no existe.");
      const { course, revision } = await this.lockedCourse(
        tx,
        reference.courseId,
        operation === "schedule",
      );
      const [previous] = await tx
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.id, id))
        .for("update");
      if (!previous)
        throw new GroupError("GROUP_NOT_FOUND", "El grupo no existe.");
      if (previous.updatedAt.getTime() !== expected.getTime())
        throw new GroupError(
          "STALE_GROUP",
          "El grupo cambió desde la última lectura.",
        );
      if (previous.status === "CANCELLED")
        throw new GroupError(
          "GROUP_CANCELLED",
          "Un grupo cancelado no puede modificarse.",
        );
      if (
        operation === "schedule" &&
        previous.courseTypeRevisionId !== revision.id
      )
        throw new GroupError(
          "COURSE_UNAVAILABLE",
          "El formato del curso ya no coincide con el grupo.",
        );
      let changes: Partial<
        Pick<Row, "startsAt" | "endsAt" | "capacity" | "status">
      >;
      if (operation === "schedule") {
        const plan = groupPlan(course, revision, value as string);
        if (previous.startsAt.getTime() === plan.startsAt.getTime())
          return previous;
        await this.assertFree(tx, course.id, plan.startsAt, plan.endsAt, id);
        changes = { startsAt: plan.startsAt, endsAt: plan.endsAt };
      } else if (operation === "capacity") {
        assertCapacity(value as number);
        if (previous.capacity === value) return previous;
        changes = { capacity: value as number };
      } else changes = { status: "CANCELLED" };
      const [row] = await tx
        .update(schema.groups)
        .set({ ...changes, updatedAt: nextVersion(previous.updatedAt) })
        .where(
          and(eq(schema.groups.id, id), eq(schema.groups.updatedAt, expected)),
        )
        .returning();
      if (!row)
        throw new GroupError(
          "STALE_GROUP",
          "El grupo cambió antes de guardar.",
        );
      await this.audit(
        tx,
        actorId,
        row,
        operation === "schedule"
          ? "GROUP_SCHEDULE_CHANGED"
          : operation === "capacity"
            ? "GROUP_CAPACITY_CHANGED"
            : "GROUP_CANCELLED",
        operation === "cancel"
          ? {}
          : {
              from:
                operation === "capacity"
                  ? previous.capacity
                  : previous.startsAt.toISOString(),
              to:
                operation === "capacity"
                  ? row.capacity
                  : row.startsAt.toISOString(),
            },
      );
      return row;
    });
  }

  changeSchedule(
    id: string,
    startTime: string,
    actorId: string,
    revision: Date,
  ) {
    return this.mutate(id, actorId, revision, "schedule", startTime);
  }
  changeCapacity(
    id: string,
    capacity: number,
    actorId: string,
    revision: Date,
  ) {
    return this.mutate(id, actorId, revision, "capacity", capacity);
  }
  cancel(id: string, actorId: string, revision: Date) {
    return this.mutate(id, actorId, revision, "cancel");
  }
}
