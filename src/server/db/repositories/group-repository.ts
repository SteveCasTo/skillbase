import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { GroupRepository } from "@/application/groups/group-repository";
import {
  assertCapacity,
  GroupError,
  groupPlan,
  overlaps,
} from "@/domain/groups/rules";
import * as schema from "@/server/db/schema";
import { occupiedSeats } from "./registration-support";
import { cancelRegisteredGroup } from "./registered-group-cancellation";
import {
  instructorHasConflict,
  lockInstructorSchedules,
} from "./instructor-schedule";

type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Row = typeof schema.groups.$inferSelect;

function nextVersion(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

export class DrizzleGroupRepository implements GroupRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

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
    requireAvailable = true,
    requirePlan = true,
  ) {
    await lockInstructorSchedules(tx, id);
    const [course] = await tx
      .select()
      .from(schema.courses)
      .where(eq(schema.courses.id, id))
      .for("update");
    if (
      !course ||
      (requireAvailable && course.status === "ARCHIVED") ||
      (requirePlan && course.weekdaysMask !== 31)
    )
      throw new GroupError(
        "COURSE_UNAVAILABLE",
        "Solo cursos no archivados y planificados admiten grupos.",
      );
    const [revision] = await tx
      .select()
      .from(schema.courseTypeRevisions)
      .where(eq(schema.courseTypeRevisions.id, course.courseTypeRevisionId));
    if (!revision || (requirePlan && revision.sessionMinutes === null))
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
    const [course] = await tx
      .select({ instructorId: schema.courses.instructorId })
      .from(schema.courses)
      .where(eq(schema.courses.id, courseId));
    if (
      await instructorHasConflict(tx, courseId, course?.instructorId, [
        { startsAt, endsAt },
      ])
    )
      throw new GroupError(
        "SCHEDULE_CONFLICT",
        "El instructor tiene otro curso en ese horario.",
      );
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

  private async assertCanRemovePlannedGroup(
    tx: Transaction,
    course: Pick<typeof schema.courses.$inferSelect, "id" | "status">,
    group: Pick<Row, "id" | "status">,
  ): Promise<void> {
    if (course.status !== "PUBLISHED" || group.status !== "PLANNED") return;
    const [other] = await tx
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .where(
        and(
          eq(schema.groups.courseId, course.id),
          eq(schema.groups.status, "PLANNED"),
          ne(schema.groups.id, group.id),
        ),
      )
      .limit(1);
    if (!other)
      throw new GroupError(
        "COURSE_UNAVAILABLE",
        "No se puede desactivar el último grupo de un curso publicado. Añade o reactiva otro grupo, o retira el curso primero.",
      );
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
          publishedAt: course.status === "PUBLISHED" ? new Date() : null,
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
    operation: "schedule" | "capacity" | "cancel" | "reactivate",
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
        operation !== "cancel",
        operation !== "cancel",
      );
      const [previous] = await tx
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.id, id))
        .for("update");
      if (!previous)
        throw new GroupError("GROUP_NOT_FOUND", "El grupo no existe.");
      if (previous.courseId !== course.id)
        throw new GroupError("GROUP_NOT_FOUND", "El grupo no existe.");
      if (previous.updatedAt.getTime() !== expected.getTime())
        throw new GroupError(
          "STALE_GROUP",
          "El grupo cambió desde la última lectura.",
        );
      if (operation === "reactivate" && previous.status !== "CANCELLED")
        throw new GroupError("GROUP_ACTIVE", "El grupo ya está planificado.");
      if (operation !== "reactivate" && previous.status === "CANCELLED")
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
        Pick<Row, "startsAt" | "endsAt" | "capacity" | "status" | "publishedAt">
      >;
      if (operation === "schedule") {
        const plan = groupPlan(course, revision, value as string);
        if (previous.startsAt.getTime() === plan.startsAt.getTime())
          return previous;
        await this.assertFree(tx, course.id, plan.startsAt, plan.endsAt, id);
        changes = { startsAt: plan.startsAt, endsAt: plan.endsAt };
      } else if (operation === "capacity") {
        assertCapacity(value as number);
        if ((value as number) < (await occupiedSeats(tx, id)))
          throw new GroupError(
            "VALIDATION_FAILED",
            "El cupo no puede ser menor que la cantidad de registros vigentes. Cambia participantes de grupo antes de reducirlo.",
          );
        if (previous.capacity === value) return previous;
        changes = { capacity: value as number };
      } else if (operation === "reactivate") {
        if (previous.courseTypeRevisionId !== revision.id)
          throw new GroupError(
            "COURSE_UNAVAILABLE",
            "El formato del curso ya no coincide con el grupo.",
          );
        await this.assertFree(
          tx,
          course.id,
          previous.startsAt,
          previous.endsAt,
          id,
        );
        changes = {
          status: "PLANNED",
          publishedAt:
            previous.publishedAt ??
            (course.status === "PUBLISHED" ? new Date() : null),
        };
      } else {
        await this.assertCanRemovePlannedGroup(tx, course, previous);
        await cancelRegisteredGroup(
          tx,
          course.id,
          previous.id,
          actorId,
          this.clock(),
        );
        changes = { status: "CANCELLED" };
      }
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
            : operation === "reactivate"
              ? "GROUP_REACTIVATED"
              : "GROUP_CANCELLED",
        operation === "cancel" || operation === "reactivate"
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
  reactivate(id: string, actorId: string, revision: Date) {
    return this.mutate(id, actorId, revision, "reactivate");
  }

  async delete(id: string, actorId: string, expected: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [reference] = await tx
        .select({ courseId: schema.groups.courseId })
        .from(schema.groups)
        .where(eq(schema.groups.id, id));
      if (!reference)
        throw new GroupError("GROUP_NOT_FOUND", "El grupo no existe.");
      const { course } = await this.lockedCourse(
        tx,
        reference.courseId,
        false,
        false,
      );
      const [previous] = await tx
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.id, id))
        .for("update");
      if (!previous || previous.courseId !== course.id)
        throw new GroupError("GROUP_NOT_FOUND", "El grupo no existe.");
      if (previous.updatedAt.getTime() !== expected.getTime())
        throw new GroupError(
          "STALE_GROUP",
          "El grupo cambió desde la última lectura.",
        );
      if (previous.publishedAt !== null)
        throw new GroupError(
          "GROUP_PUBLISHED",
          "Un grupo que ya fue publicado no puede eliminarse; desactívalo.",
        );
      await this.assertCanRemovePlannedGroup(tx, course, previous);
      const [history] = await tx
        .select({ id: schema.preRegistrations.id })
        .from(schema.preRegistrations)
        .where(eq(schema.preRegistrations.groupId, id))
        .limit(1);
      if (history)
        throw new GroupError(
          "GROUP_PUBLISHED",
          "El grupo tiene historial de participantes y no puede eliminarse; cancélalo.",
        );
      const [deleted] = await tx
        .delete(schema.groups)
        .where(
          and(
            eq(schema.groups.id, id),
            eq(schema.groups.updatedAt, expected),
            sql`${schema.groups.publishedAt} is null`,
          ),
        )
        .returning();
      if (!deleted)
        throw new GroupError(
          "STALE_GROUP",
          "El grupo cambió antes de eliminarlo.",
        );
      await this.audit(tx, actorId, previous, "GROUP_DELETED", {
        courseId: previous.courseId,
        status: previous.status,
      });
    });
  }
}
