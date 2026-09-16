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
type CourseRow = typeof schema.courses.$inferSelect;
type PriceRow = typeof schema.coursePrices.$inferSelect;

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

function pricesFor(
  courseId: string,
  rows: readonly PriceRow[],
): readonly CoursePrice[] {
  return rows
    .filter((row) => row.courseId === courseId)
    .sort((left, right) =>
      left.participantType.localeCompare(right.participantType),
    )
    .map(({ participantType, amount }) => ({
      participantType,
      amount,
      currency: "BOB",
    }));
}

function toAdmin(
  row: CourseRow,
  prices: readonly PriceRow[],
  now = new Date(),
): AdminCourseDto {
  return {
    ...row,
    prices: pricesFor(row.id, prices),
    registrationAvailability: registrationAvailability(
      row.registrationStartAt,
      row.registrationEndAt,
      now,
    ),
  };
}

function toPublic(
  row: CourseRow,
  prices: readonly PriceRow[],
  now = new Date(),
): PublicCourseDto {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    level: row.level,
    totalHours: row.totalHours,
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
    prices: pricesFor(row.id, prices),
  };
}

async function loadPrices(
  db: Database,
  courseIds: readonly string[],
): Promise<readonly PriceRow[]> {
  if (courseIds.length === 0) return [];
  return db
    .select()
    .from(schema.coursePrices)
    .where(inArray(schema.coursePrices.courseId, [...courseIds]));
}

function courseValues(input: CourseData) {
  return {
    name: input.name,
    description: input.description,
    level: input.level,
    totalHours: input.totalHours,
    schedule: input.schedule,
    conditions: input.conditions,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    registrationStartAt: input.registrationStartAt,
    registrationEndAt: input.registrationEndAt,
    minimumGrade: input.minimumGrade,
  };
}

function priceValues(
  courseId: string,
  input: CourseData,
  updatedAt = new Date(),
) {
  return input.prices.map((price) => ({ ...price, courseId, updatedAt }));
}

function changedFields(previous: CourseRow, input: CourseData): string[] {
  const next = courseValues(input);
  return Object.entries(next).flatMap(([key, value]) => {
    const oldValue = previous[key as keyof typeof next];
    const oldComparable =
      oldValue instanceof Date ? oldValue.toISOString() : oldValue;
    const nextComparable = value instanceof Date ? value.toISOString() : value;
    return oldComparable === nextComparable ? [] : [key];
  });
}

function nextRevision(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

function assertPublishablePrices(rows: readonly PriceRow[]): void {
  const exactTypes = new Set(
    rows.map(({ participantType }) => participantType),
  );
  const isComplete =
    rows.length === 2 &&
    exactTypes.size === 2 &&
    exactTypes.has("STUDENT") &&
    exactTypes.has("EXTERNAL") &&
    rows.every(({ currency }) => currency === "BOB");
  if (!isComplete)
    throw new CourseDomainError(
      "COURSE_PRICES_INCOMPLETE",
      "El curso requiere exactamente los precios STUDENT y EXTERNAL en BOB antes de publicarse.",
    );
}

export class DrizzleCourseRepository implements CourseRepository {
  constructor(private readonly db: Database) {}

  async create(input: CourseData, actorId: string): Promise<AdminCourseDto> {
    return persistence("create", () =>
      this.db.transaction(async (tx) => {
        const baseSlug = normalizeSlug(input.name);
        await tx.execute(sql`select pg_advisory_xact_lock(20260915, 1)`);
        const matching = await tx
          .select({ slug: schema.courses.slug })
          .from(schema.courses)
          .where(
            sql`${schema.courses.slug} = ${baseSlug} or ${schema.courses.slug} ~ ${`^${baseSlug}-[0-9]+$`}`,
          );
        const used = new Set(matching.map(({ slug }) => slug));
        let slug = baseSlug;
        for (let suffix = 2; used.has(slug); suffix += 1)
          slug = `${baseSlug}-${suffix}`;
        const updatedAt = new Date();
        const [course] = await tx
          .insert(schema.courses)
          .values({ ...courseValues(input), slug, updatedAt })
          .returning();
        if (!course) throw new Error("Created course was not returned");
        const prices = await tx
          .insert(schema.coursePrices)
          .values(priceValues(course.id, input))
          .returning();
        await tx.insert(schema.auditEvents).values({
          actorId,
          action: "COURSE_CREATED",
          entityType: "COURSE",
          entityId: course.id,
          metadata: { slug },
        });
        return toAdmin(course, prices);
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
        const [previous] = await tx
          .select()
          .from(schema.courses)
          .where(eq(schema.courses.id, id))
          .limit(1)
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
            "El curso cambió desde que abriste esta página. Revisa los datos y vuelve a guardar.",
          );
        const oldPrices = await tx
          .select()
          .from(schema.coursePrices)
          .where(eq(schema.coursePrices.courseId, id));
        const changed = changedFields(previous, input);
        const changedPriceTypes = input.prices.flatMap((price) => {
          const old = oldPrices.find(
            (candidate) => candidate.participantType === price.participantType,
          );
          return !old ||
            old.amount !== price.amount ||
            old.currency !== price.currency
            ? [price.participantType]
            : [];
        });
        if (changed.length === 0 && changedPriceTypes.length === 0)
          return toAdmin(previous, oldPrices);
        const updatedAt = nextRevision(previous.updatedAt);
        const [course] = await tx
          .update(schema.courses)
          .set({ ...courseValues(input), updatedAt })
          .where(
            and(
              eq(schema.courses.id, id),
              eq(schema.courses.updatedAt, expectedUpdatedAt),
            ),
          )
          .returning();
        if (!course)
          throw new CourseDomainError(
            "STALE_COURSE",
            "El curso cambió antes de completar el guardado. Revisa los datos y vuelve a intentarlo.",
          );
        const prices = await Promise.all(
          priceValues(id, input).map(async (price) => {
            const [saved] = await tx
              .insert(schema.coursePrices)
              .values(price)
              .onConflictDoUpdate({
                target: [
                  schema.coursePrices.courseId,
                  schema.coursePrices.participantType,
                ],
                set: {
                  amount: price.amount,
                  currency: price.currency,
                  updatedAt: price.updatedAt,
                },
              })
              .returning();
            if (!saved) throw new Error("Updated price was not returned");
            return saved;
          }),
        );
        if (changed.length > 0)
          await tx.insert(schema.auditEvents).values({
            actorId,
            action: "COURSE_UPDATED",
            entityType: "COURSE",
            entityId: id,
            metadata: { fields: changed.join(",") },
          });
        if (changedPriceTypes.length > 0)
          await tx.insert(schema.auditEvents).values({
            actorId,
            action: "COURSE_PRICES_UPDATED",
            entityType: "COURSE",
            entityId: id,
            metadata: { participantTypes: changedPriceTypes.sort().join(",") },
          });
        return toAdmin(course, prices);
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
        const [previous] = await tx
          .select()
          .from(schema.courses)
          .where(eq(schema.courses.id, id))
          .limit(1)
          .for("update");
        if (!previous)
          throw new CourseDomainError(
            "COURSE_NOT_FOUND",
            "El curso no existe.",
          );
        assertTransition(previous.status, next);
        const prices = await loadPrices(tx, [id]);
        if (next === "PUBLISHED") assertPublishablePrices(prices);
        const updatedAt = nextRevision(previous.updatedAt);
        const [course] = await tx
          .update(schema.courses)
          .set({ status: next, updatedAt })
          .where(eq(schema.courses.id, id))
          .returning();
        if (!course) throw new Error("Transitioned course was not returned");
        const action =
          next === "PUBLISHED"
            ? "COURSE_PUBLISHED"
            : next === "DRAFT"
              ? "COURSE_WITHDRAWN"
              : "COURSE_ARCHIVED";
        await tx.insert(schema.auditEvents).values({
          actorId,
          action,
          entityType: "COURSE",
          entityId: id,
          metadata: { from: previous.status, to: next },
        });
        return toAdmin(course, prices);
      }),
    );
  }

  async listAdmin(): Promise<readonly AdminCourseDto[]> {
    return persistence("listAdmin", async () => {
      const rows = await this.db
        .select()
        .from(schema.courses)
        .orderBy(desc(schema.courses.createdAt));
      const prices = await loadPrices(
        this.db,
        rows.map(({ id }) => id),
      );
      return rows.map((row) => toAdmin(row, prices));
    });
  }

  async getAdmin(id: string): Promise<AdminCourseDto | null> {
    return persistence("getAdmin", async () => {
      const [row] = await this.db
        .select()
        .from(schema.courses)
        .where(eq(schema.courses.id, id))
        .limit(1);
      return row ? toAdmin(row, await loadPrices(this.db, [id])) : null;
    });
  }

  async listPublic(now = new Date()): Promise<readonly PublicCourseDto[]> {
    return persistence("listPublic", async () => {
      const rows = await this.db
        .select()
        .from(schema.courses)
        .where(eq(schema.courses.status, "PUBLISHED"))
        .orderBy(asc(schema.courses.startsAt));
      const prices = await loadPrices(
        this.db,
        rows.map(({ id }) => id),
      );
      return rows.map((row) => toPublic(row, prices, now));
    });
  }

  async getPublic(
    slug: string,
    now = new Date(),
  ): Promise<PublicCourseDto | null> {
    let normalizedSlug: string;
    try {
      normalizedSlug = normalizeSlug(slug);
    } catch (error) {
      if (error instanceof CourseDomainError) return null;
      throw error;
    }
    return persistence("getPublic", async () => {
      const [row] = await this.db
        .select()
        .from(schema.courses)
        .where(
          sql`${schema.courses.slug} = ${normalizedSlug} and ${schema.courses.status} = 'PUBLISHED'`,
        )
        .limit(1);
      return row
        ? toPublic(row, await loadPrices(this.db, [row.id]), now)
        : null;
    });
  }
}
