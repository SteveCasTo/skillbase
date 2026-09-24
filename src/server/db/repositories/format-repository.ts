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
  return {
    id: type.id,
    name: type.name,
    active: type.active,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    totalHours: revision.totalHours,
    studentAmount: revision.studentAmount,
    externalAmount: revision.externalAmount,
  };
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
          .set({ updatedAt: new Date() })
          .where(eq(schema.courseTypes.id, id));
        await tx.insert(schema.auditEvents).values({
          actorId,
          entityType: "COURSE_TYPE",
          entityId: id,
          action: "COURSE_TYPE_REVISED",
          metadata: { revisionNumber: revision.revisionNumber },
        });
        return latest(tx, type);
      }),
    );
  }

  async setActive(
    id: string,
    active: boolean,
    actorId: string,
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
        if (type.active === active) return latest(tx, type);
        const [updated] = await tx
          .update(schema.courseTypes)
          .set({ active, updatedAt: new Date() })
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
