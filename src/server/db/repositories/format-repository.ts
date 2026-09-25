import { asc, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { FormatRepository } from "@/application/courses/format-repository";
import type { CourseFormat, FormatValues } from "@/domain/courses/formats";
import { CourseDomainError } from "@/domain/courses/errors";
import * as schema from "@/server/db/schema";
import { CourseInfrastructureError } from "./course-infrastructure-error";

type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function persistence<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CourseDomainError) throw error;
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505" &&
      "constraint_name" in error &&
      error.constraint_name === "course_types_name_unique"
    )
      throw new CourseDomainError(
        "VALIDATION_FAILED",
        "Revisa los campos indicados.",
        { name: "Ya existe un formato con ese nombre." },
      );
    throw new CourseInfrastructureError(
      operation,
      `Format persistence failed during ${operation}`,
      error,
    );
  }
}

async function latest(
  db: Database | Transaction,
  type: typeof schema.courseTypes.$inferSelect,
): Promise<CourseFormat> {
  const [revision] = await db
    .select()
    .from(schema.courseTypeRevisions)
    .where(eq(schema.courseTypeRevisions.courseTypeId, type.id))
    .orderBy(desc(schema.courseTypeRevisions.revisionNumber))
    .limit(1);
  if (!revision) throw new Error("Format has no revision");
  const [usage] = await db
    .select({
      used: sql<boolean>`exists (select 1 from courses c join course_type_revisions r on c.course_type_revision_id = r.id where r.course_type_id = ${type.id})`,
    })
    .from(schema.courseTypes)
    .where(eq(schema.courseTypes.id, type.id));
  return {
    id: type.id,
    name: type.name,
    active: type.active,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    totalHours: revision.totalHours,
    studentAmount: revision.studentAmount,
    externalAmount: revision.externalAmount,
    used: usage?.used ?? false,
    updatedAt: type.updatedAt.toISOString(),
  };
}

function assertFresh(
  format: CourseFormat,
  revisionId?: string,
  updatedAt?: string,
) {
  if (
    !revisionId ||
    !updatedAt ||
    format.revisionId !== revisionId ||
    format.updatedAt !== updatedAt
  )
    throw new CourseDomainError(
      "INVALID_TRANSITION",
      "El formato cambió desde que abriste esta página. Recarga y revisa los valores vigentes.",
    );
}

async function locked(tx: Transaction, id: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(20260915, 3)`);
  const [type] = await tx
    .select()
    .from(schema.courseTypes)
    .where(eq(schema.courseTypes.id, id))
    .for("update");
  if (!type)
    throw new CourseDomainError("FORMAT_NOT_FOUND", "El formato no existe.");
  return { type, format: await latest(tx, type) };
}

export class DrizzleFormatRepository implements FormatRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<readonly CourseFormat[]> {
    return persistence("listFormats", async () => {
      const rows = await this.db
        .select()
        .from(schema.courseTypes)
        .orderBy(asc(schema.courseTypes.name));
      return Promise.all(rows.map((row) => latest(this.db, row)));
    });
  }

  async get(id: string): Promise<CourseFormat | null> {
    return persistence("getFormat", async () => {
      const [type] = await this.db
        .select()
        .from(schema.courseTypes)
        .where(eq(schema.courseTypes.id, id));
      return type ? latest(this.db, type) : null;
    });
  }

  async rename(
    id: string,
    name: string,
    revisionId: string,
    updatedAt: string,
    actorId: string,
  ): Promise<CourseFormat> {
    return persistence("renameFormat", () =>
      this.db.transaction(async (tx) => {
        const { type, format } = await locked(tx, id);
        assertFresh(format, revisionId, updatedAt);
        if (type.name === name) return format;
        const [updated] = await tx
          .update(schema.courseTypes)
          .set({
            name,
            updatedAt: sql`greatest(now(), ${schema.courseTypes.updatedAt} + interval '1 millisecond')`,
          })
          .where(eq(schema.courseTypes.id, id))
          .returning();
        if (!updated) throw new Error("Format update failed");
        await tx.insert(schema.auditEvents).values({
          actorId,
          entityType: "COURSE_TYPE",
          entityId: id,
          action: "COURSE_TYPE_RENAMED",
        });
        return latest(tx, updated);
      }),
    );
  }

  async delete(
    id: string,
    revisionId: string,
    updatedAt: string,
    actorId: string,
  ): Promise<void> {
    return persistence("deleteFormat", () =>
      this.db.transaction(async (tx) => {
        const { format } = await locked(tx, id);
        assertFresh(format, revisionId, updatedAt);
        if (format.used)
          throw new CourseDomainError(
            "INVALID_TRANSITION",
            "Este formato tiene cursos asociados. Desactívalo en lugar de eliminarlo.",
          );
        await tx.execute(
          sql`select set_config('app.delete_unused_format_id', ${id}, true)`,
        );
        await tx
          .delete(schema.courseTypeRevisions)
          .where(eq(schema.courseTypeRevisions.courseTypeId, id));
        await tx
          .delete(schema.courseTypes)
          .where(eq(schema.courseTypes.id, id));
        await tx.insert(schema.auditEvents).values({
          actorId,
          entityType: "COURSE_TYPE",
          entityId: id,
          action: "COURSE_TYPE_DELETED",
        });
      }),
    );
  }

  async create(
    name: string,
    values: FormatValues,
    actorId: string,
  ): Promise<CourseFormat> {
    return persistence("createFormat", () =>
      this.db.transaction(async (tx) => {
        const [type] = await tx
          .insert(schema.courseTypes)
          .values({ name })
          .returning();
        if (!type) throw new Error("Format insert failed");
        await tx
          .insert(schema.courseTypeRevisions)
          .values({ courseTypeId: type.id, revisionNumber: 1, ...values });
        await tx.insert(schema.auditEvents).values({
          actorId,
          entityType: "COURSE_TYPE",
          entityId: type.id,
          action: "COURSE_TYPE_CREATED",
        });
        return latest(tx, type);
      }),
    );
  }

  async revise(
    id: string,
    values: FormatValues,
    actorId: string,
    revisionId?: string,
    updatedAt?: string,
  ): Promise<CourseFormat> {
    return persistence("reviseFormat", () =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(20260915, 3)`);
        const [type] = await tx
          .select()
          .from(schema.courseTypes)
          .where(eq(schema.courseTypes.id, id))
          .for("update");
        if (!type)
          throw new CourseDomainError(
            "FORMAT_NOT_FOUND",
            "El formato no existe.",
          );
        if (!type.active)
          throw new CourseDomainError(
            "FORMAT_INACTIVE",
            "Activa el formato antes de editarlo.",
          );
        const previous = await latest(tx, type);
        if (revisionId !== undefined || updatedAt !== undefined)
          assertFresh(previous, revisionId, updatedAt);
        if (
          previous.totalHours === values.totalHours &&
          previous.studentAmount === values.studentAmount &&
          previous.externalAmount === values.externalAmount
        )
          return previous;
        const [revision] = await tx
          .insert(schema.courseTypeRevisions)
          .values({
            courseTypeId: id,
            revisionNumber: previous.revisionNumber + 1,
            ...values,
          })
          .returning();
        if (!revision) throw new Error("Format revision insert failed");
        // Drafts follow the current revision; preserve optimistic editing by bumping their version.
        await tx
          .update(schema.courses)
          .set({
            courseTypeRevisionId: revision.id,
            updatedAt: sql`greatest(now(), ${schema.courses.updatedAt} + interval '1 millisecond')`,
          })
          .where(
            sql`${schema.courses.status} = 'DRAFT' and ${schema.courses.courseTypeRevisionId} in (select id from course_type_revisions where course_type_id = ${id})`,
          );
        await tx
          .update(schema.courseTypes)
          .set({
            updatedAt: sql`greatest(now(), ${schema.courseTypes.updatedAt} + interval '1 millisecond')`,
          })
          .where(eq(schema.courseTypes.id, id));
        await tx.insert(schema.auditEvents).values({
          actorId,
          entityType: "COURSE_TYPE",
          entityId: id,
          action: "COURSE_TYPE_REVISED",
          metadata: { revisionNumber: revision.revisionNumber },
        });
        const [updated] = await tx
          .select()
          .from(schema.courseTypes)
          .where(eq(schema.courseTypes.id, id));
        if (!updated) throw new Error("Format update failed");
        return latest(tx, updated);
      }),
    );
  }

  async setActive(
    id: string,
    active: boolean,
    actorId: string,
    revisionId?: string,
    updatedAt?: string,
  ): Promise<CourseFormat> {
    return persistence("setFormatActive", () =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(20260915, 3)`);
        const [type] = await tx
          .select()
          .from(schema.courseTypes)
          .where(eq(schema.courseTypes.id, id))
          .for("update");
        if (!type)
          throw new CourseDomainError(
            "FORMAT_NOT_FOUND",
            "El formato no existe.",
          );
        const previous = await latest(tx, type);
        if (revisionId !== undefined || updatedAt !== undefined)
          assertFresh(previous, revisionId, updatedAt);
        if (type.active === active) return previous;
        const [updated] = await tx
          .update(schema.courseTypes)
          .set({
            active,
            updatedAt: sql`greatest(now(), ${schema.courseTypes.updatedAt} + interval '1 millisecond')`,
          })
          .where(eq(schema.courseTypes.id, id))
          .returning();
        if (!updated) throw new Error("Format update failed");
        await tx.insert(schema.auditEvents).values({
          actorId,
          entityType: "COURSE_TYPE",
          entityId: id,
          action: active ? "COURSE_TYPE_ACTIVATED" : "COURSE_TYPE_DEACTIVATED",
        });
        return latest(tx, updated);
      }),
    );
  }
}
