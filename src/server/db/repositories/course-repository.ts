import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { CourseRepository } from "@/application/courses/course-repository";
import { CourseDomainError } from "@/domain/courses/errors";
import {
  assertTransition,
  normalizeSlug,
  registrationAvailability,
} from "@/domain/courses/policies";
import type {
  AdminCourseDto,
  CourseData,
  CoursePrice,
  CourseStatus,
  PublicCourseDto,
} from "@/domain/courses/types";
import * as schema from "@/server/db/schema";
import { CourseInfrastructureError } from "./course-infrastructure-error";

type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Row = typeof schema.courses.$inferSelect;
type Revision = typeof schema.courseTypeRevisions.$inferSelect;

async function persistence<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CourseDomainError) throw error;
    throw new CourseInfrastructureError(
      operation,
      `Course persistence failed during ${operation}`,
      error,
    );
  }
}

function prices(revision: Revision): readonly CoursePrice[] {
  return [
    {
      participantType: "STUDENT",
      amount: revision.studentAmount,
      currency: "BOB",
    },
    {
      participantType: "EXTERNAL",
      amount: revision.externalAmount,
      currency: "BOB",
    },
  ];
}

function admin(row: Row, revision: Revision, now = new Date()): AdminCourseDto {
  return {
    ...row,
    courseTypeId: revision.courseTypeId,
    totalHours: revision.totalHours,
    prices: prices(revision),
    registrationAvailability: registrationAvailability(
      row.registrationStartAt,
      row.registrationEndAt,
      now,
    ),
  };
}

function publicDto(
  row: Row,
  revision: Revision,
  now = new Date(),
): PublicCourseDto {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    contentMarkdown: row.contentMarkdown,
    instructorName: row.instructorName,
    artwork: row.artwork,
    featured: row.featured,
    level: row.level,
    totalHours: revision.totalHours,
    prices: prices(revision),
    schedule: row.schedule,
    conditions: row.conditions,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    registrationStartAt: row.registrationStartAt,
    registrationEndAt: row.registrationEndAt,
    registrationAvailability: registrationAvailability(
      row.registrationStartAt,
      row.registrationEndAt,
      now,
    ),
  };
}

async function revisions(
  db: Database | Transaction,
  rows: readonly Row[],
): Promise<Map<string, Revision>> {
  if (!rows.length) return new Map();
  const found = await db
    .select()
    .from(schema.courseTypeRevisions)
    .where(
      inArray(
        schema.courseTypeRevisions.id,
        rows.map((row) => row.courseTypeRevisionId),
      ),
    );
  return new Map(found.map((row) => [row.id, row]));
}

function revisionFor(row: Row, found: Map<string, Revision>): Revision {
  const revision = found.get(row.courseTypeRevisionId);
  if (!revision) throw new Error("Course revision missing");
  return revision;
}

async function currentRevision(
  db: Transaction,
  id: string,
  requireActive = true,
): Promise<Revision> {
  const [type] = await db
    .select()
    .from(schema.courseTypes)
    .where(eq(schema.courseTypes.id, id))
    .for("update");
  if (!type)
    throw new CourseDomainError(
      "FORMAT_NOT_FOUND",
      "Selecciona un formato existente.",
      { courseTypeId: "Selecciona un formato existente." },
    );
  if (requireActive && !type.active)
    throw new CourseDomainError(
      "FORMAT_INACTIVE",
      "El formato está desactivado.",
      { courseTypeId: "Selecciona un formato activo." },
    );
  const [revision] = await db
    .select()
    .from(schema.courseTypeRevisions)
    .where(eq(schema.courseTypeRevisions.courseTypeId, id))
    .orderBy(desc(schema.courseTypeRevisions.revisionNumber))
    .limit(1);
  if (!revision) throw new Error("Format has no revision");
  return revision;
}

function values(input: CourseData) {
  return {
    name: input.name,
    description: input.description,
    level: input.level,
    schedule: input.schedule,
    conditions: input.conditions,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    registrationStartAt: input.registrationStartAt,
    registrationEndAt: input.registrationEndAt,
    minimumGrade: input.minimumGrade,
    contentMarkdown: input.contentMarkdown,
    instructorName: input.instructorName,
    artwork: input.artwork,
  };
}

function changed(
  previous: Row,
  input: CourseData,
  revisionId: string,
): string[] {
  const next = { ...values(input), courseTypeRevisionId: revisionId };
  return Object.entries(next).flatMap(([key, value]) => {
    const old = previous[key as keyof typeof next];
    return (old instanceof Date ? old.toISOString() : old) ===
      (value instanceof Date ? value.toISOString() : value)
      ? []
      : [key];
  });
}

function nextVersion(previous: Date) {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

export class DrizzleCourseRepository implements CourseRepository {
  constructor(private readonly db: Database) {}

  async create(input: CourseData, actorId: string): Promise<AdminCourseDto> {
    return persistence("create", () =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(20260915, 3)`);
        const revision = await currentRevision(tx, input.courseTypeId);
        const baseSlug = normalizeSlug(input.name);
        await tx.execute(sql`select pg_advisory_xact_lock(20260915, 1)`);
        const matching = await tx
          .select({ slug: schema.courses.slug })
          .from(schema.courses)
          .where(
            sql`${schema.courses.slug} = ${baseSlug} or ${schema.courses.slug} ~ ${`^${baseSlug}-[0-9]+$`}`,
          );
        const used = new Set(matching.map((row) => row.slug));
        let slug = baseSlug;
        for (let suffix = 2; used.has(slug); suffix++)
          slug = `${baseSlug}-${suffix}`;
        const [row] = await tx
          .insert(schema.courses)
          .values({
            ...values(input),
            courseTypeRevisionId: revision.id,
            slug,
            updatedAt: new Date(),
          })
          .returning();
        if (!row) throw new Error("Course insert failed");
        await tx.insert(schema.auditEvents).values({
          actorId,
          entityType: "COURSE",
          entityId: row.id,
          action: "COURSE_CREATED",
          metadata: { slug },
        });
        return admin(row, revision);
      }),
    );
  }

  async update(
    id: string,
    input: CourseData,
    actorId: string,
    expectedUpdatedAt: Date,
  ): Promise<AdminCourseDto> {
    return persistence("update", () =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(20260915, 3)`);
        const [previous] = await tx
          .select()
          .from(schema.courses)
          .where(eq(schema.courses.id, id))
          .for("update");
        if (!previous)
          throw new CourseDomainError(
            "COURSE_NOT_FOUND",
            "El curso no existe.",
          );
        if (previous.status === "ARCHIVED")
          throw new CourseDomainError(
            "COURSE_ARCHIVED",
            "Un curso archivado no puede editarse.",
          );
        if (previous.updatedAt.getTime() !== expectedUpdatedAt.getTime())
          throw new CourseDomainError(
            "STALE_COURSE",
            "El curso cambió desde que abriste esta página.",
          );
        const existing = revisionFor(previous, await revisions(tx, [previous]));
        // Published content is editable, but its commercial terms remain pinned until withdrawn.
        if (
          previous.status === "PUBLISHED" &&
          existing.courseTypeId !== input.courseTypeId
        )
          throw new CourseDomainError(
            "INVALID_TRANSITION",
            "Retira el curso antes de cambiar su formato.",
          );
        const revision =
          previous.status === "PUBLISHED"
            ? existing
            : await currentRevision(tx, input.courseTypeId);
        const fields = changed(previous, input, revision.id);
        if (!fields.length) return admin(previous, revision);
        const [row] = await tx
          .update(schema.courses)
          .set({
            ...values(input),
            courseTypeRevisionId: revision.id,
            updatedAt: nextVersion(previous.updatedAt),
          })
          .where(
            and(
              eq(schema.courses.id, id),
              eq(schema.courses.updatedAt, expectedUpdatedAt),
            ),
          )
          .returning();
        if (!row)
          throw new CourseDomainError(
            "STALE_COURSE",
            "El curso cambió antes de completar el guardado.",
          );
        await tx.insert(schema.auditEvents).values({
          actorId,
          entityType: "COURSE",
          entityId: id,
          action: "COURSE_UPDATED",
          metadata: { fields: fields.join(",") },
        });
        return admin(row, revision);
      }),
    );
  }

  async transition(
    id: string,
    next: CourseStatus,
    actorId: string,
  ): Promise<AdminCourseDto> {
    return persistence("transition", () =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(20260915, 3)`);
        const [previous] = await tx
          .select()
          .from(schema.courses)
          .where(eq(schema.courses.id, id))
          .for("update");
        if (!previous)
          throw new CourseDomainError(
            "COURSE_NOT_FOUND",
            "El curso no existe.",
          );
        assertTransition(previous.status, next);
        const existing = revisionFor(previous, await revisions(tx, [previous]));
        // Withdrawal is allowed even when the format was deactivated; publishing is not.
        const revision =
          next === "DRAFT"
            ? await currentRevision(tx, existing.courseTypeId, false)
            : next === "PUBLISHED"
              ? await currentRevision(tx, existing.courseTypeId)
              : existing;
        const [row] = await tx
          .update(schema.courses)
          .set({
            status: next,
            featured: next === "PUBLISHED" ? previous.featured : false,
            courseTypeRevisionId: revision.id,
            updatedAt: nextVersion(previous.updatedAt),
          })
          .where(eq(schema.courses.id, id))
          .returning();
        if (!row) throw new Error("Transition failed");
        await tx.insert(schema.auditEvents).values({
          actorId,
          entityType: "COURSE",
          entityId: id,
          action:
            next === "PUBLISHED"
              ? "COURSE_PUBLISHED"
              : next === "DRAFT"
                ? "COURSE_WITHDRAWN"
                : "COURSE_ARCHIVED",
          metadata: { from: previous.status, to: next },
        });
        return admin(row, revision);
      }),
    );
  }

  async setFeatured(id: string, actorId: string): Promise<AdminCourseDto> {
    return persistence("setFeatured", () =>
      this.db.transaction(async (tx) => {
        // Serialize competing selections; the partial unique index also protects direct writes.
        await tx.execute(sql`select pg_advisory_xact_lock(20260915, 2)`);
        const [target] = await tx
          .select()
          .from(schema.courses)
          .where(eq(schema.courses.id, id))
          .for("update");
        if (!target || target.status !== "PUBLISHED")
          throw new CourseDomainError(
            "INVALID_TRANSITION",
            "Solo un curso publicado puede destacarse.",
          );
        if (target.featured)
          return admin(
            target,
            revisionFor(target, await revisions(tx, [target])),
          );
        await tx
          .update(schema.courses)
          .set({
            featured: false,
            updatedAt: sql`greatest(now(), ${schema.courses.updatedAt} + interval '1 millisecond')`,
          })
          .where(eq(schema.courses.featured, true));
        const [row] = await tx
          .update(schema.courses)
          .set({ featured: true, updatedAt: nextVersion(target.updatedAt) })
          .where(eq(schema.courses.id, id))
          .returning();
        if (!row) throw new Error("Featured course missing");
        await tx.insert(schema.auditEvents).values({
          actorId,
          entityType: "COURSE",
          entityId: id,
          action: "COURSE_FEATURED",
        });
        return admin(row, revisionFor(row, await revisions(tx, [row])));
      }),
    );
  }

  async listAdmin(): Promise<readonly AdminCourseDto[]> {
    return persistence("listAdmin", async () => {
      const rows = await this.db
        .select()
        .from(schema.courses)
        .orderBy(desc(schema.courses.createdAt));
      const found = await revisions(this.db, rows);
      return rows.map((row) => admin(row, revisionFor(row, found)));
    });
  }
  async getAdmin(id: string): Promise<AdminCourseDto | null> {
    return persistence("getAdmin", async () => {
      const [row] = await this.db
        .select()
        .from(schema.courses)
        .where(eq(schema.courses.id, id))
        .limit(1);
      return row
        ? admin(row, revisionFor(row, await revisions(this.db, [row])))
        : null;
    });
  }
  async listPublic(now = new Date()): Promise<readonly PublicCourseDto[]> {
    return persistence("listPublic", async () => {
      const rows = await this.db
        .select()
        .from(schema.courses)
        .where(eq(schema.courses.status, "PUBLISHED"))
        .orderBy(desc(schema.courses.featured), asc(schema.courses.startsAt));
      const found = await revisions(this.db, rows);
      return rows.map((row) => publicDto(row, revisionFor(row, found), now));
    });
  }
  async getPublic(
    slug: string,
    now = new Date(),
  ): Promise<PublicCourseDto | null> {
    let normalized: string;
    try {
      normalized = normalizeSlug(slug);
    } catch (error) {
      if (error instanceof CourseDomainError) return null;
      throw error;
    }
    return persistence("getPublic", async () => {
      const [row] = await this.db
        .select()
        .from(schema.courses)
        .where(
          and(
            eq(schema.courses.slug, normalized),
            eq(schema.courses.status, "PUBLISHED"),
          ),
        )
        .limit(1);
      return row
        ? publicDto(row, revisionFor(row, await revisions(this.db, [row])), now)
        : null;
    });
  }
}
