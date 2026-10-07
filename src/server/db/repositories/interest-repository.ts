import { and, asc, count, eq, isNotNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { InterestRepository } from "@/application/interests/interest-repository";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import { InterestError, PREFERENCE_ISSUE } from "@/domain/interests/rules";
import type {
  AdminInterestMetricsDto,
  AdminInterestMutationInput,
  AdminInterestPostPayload,
  AdminInterestRegistrationDto,
  InterestStatus,
  RegisterInterestInput,
} from "@/domain/interests/types";
import * as schema from "@/server/db/schema";
type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const {
  courses,
  groups,
  interestRegistrations: interests,
  auditEvents,
} = schema;
function dto(row: typeof interests.$inferSelect): AdminInterestRegistrationDto {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function groupDto(row: typeof groups.$inferSelect) {
  return {
    id: row.id,
    startTime: instantToBoliviaCivil(row.startsAt).slice(11, 16),
    endTime: instantToBoliviaCivil(row.endsAt).slice(11, 16),
    status: row.status,
  };
}
// The immutable historical source link is the canonical terminal marker, including
// CANCELLED pre-registrations. Do not duplicate it in an interest status/column.
const unconsumedInterest = () =>
  sql`not exists (select 1 from pre_registrations where source_interest_id = ${interests.id})`;
const unavailable = () =>
  new InterestError(
    "INTEREST_UNAVAILABLE",
    409,
    "Este curso ya no recibe registros de interés.",
  );
const notFound = () =>
  new InterestError("COURSE_NOT_FOUND", 404, "Curso no encontrado.");

export class DrizzleInterestRepository implements InterestRepository {
  constructor(private readonly db: Database) {}
  async publicForm(slug: string) {
    return this.db.transaction(async (tx) => {
      const [course] = await tx
        .select({
          id: courses.id,
          deadline:
            sql<Date>`coalesce(${courses.registrationEndAt}, ${courses.startsAt})`.mapWith(
              courses.startsAt,
            ),
          available: sql<boolean>`clock_timestamp() < coalesce(${courses.registrationEndAt}, ${courses.startsAt})`,
        })
        .from(courses)
        .where(and(eq(courses.slug, slug), eq(courses.status, "PUBLISHED")))
        .for("share");
      if (!course) return null;
      const eligible = course.available
        ? await tx
            .select({
              id: groups.id,
              startsAt: groups.startsAt,
              endsAt: groups.endsAt,
            })
            .from(groups)
            .where(
              and(
                eq(groups.courseId, course.id),
                eq(groups.status, "PLANNED"),
                isNotNull(groups.publishedAt),
              ),
            )
            .orderBy(asc(groups.startsAt), asc(groups.id))
        : [];
      return {
        available: course.available,
        closesAt: course.deadline.toISOString(),
        groups: eligible.map((row) => ({
          id: row.id,
          startTime: instantToBoliviaCivil(row.startsAt).slice(11, 16),
          endTime: instantToBoliviaCivil(row.endsAt).slice(11, 16),
        })),
      };
    });
  }
  async register(slug: string, input: Required<RegisterInterestInput>) {
    await this.db.transaction(async (tx) => {
      const [course] = await tx
        .select()
        .from(courses)
        .where(eq(courses.slug, slug))
        .for("update");
      if (!course || course.status !== "PUBLISHED") throw notFound();
      const deadline = (
        course.registrationEndAt ?? course.startsAt
      ).toISOString();
      const checkTime = async () => {
        const [clock] = await tx.execute<{ open: boolean }>(
          sql`select clock_timestamp() < ${deadline}::timestamptz as open`,
        );
        if (!clock?.open) throw unavailable();
      };
      await checkTime();
      if (input.preferredGroupId) {
        const [group] = await tx
          .select({ id: groups.id })
          .from(groups)
          .where(
            and(
              eq(groups.id, input.preferredGroupId),
              eq(groups.courseId, course.id),
              eq(groups.status, "PLANNED"),
              isNotNull(groups.publishedAt),
            ),
          );
        if (!group)
          throw new InterestError(
            "VALIDATION_FAILED",
            422,
            "Revisa los campos indicados.",
            { preferredGroupId: PREFERENCE_ISSUE },
          );
      }
      // Materialized clock gives the acceptance instant, even when ON CONFLICT inserts nothing.
      const result = await tx.execute<{
        open: boolean;
      }>(sql`with acceptance as materialized (select clock_timestamp() < ${deadline}::timestamptz as open), inserted as (
        insert into interest_registrations (course_id, first_name, last_name, email, phone, preferred_group_id)
        select ${course.id}::uuid, ${input.firstName}, ${input.lastName}, ${input.email}, ${input.phone}, ${input.preferredGroupId}::uuid from acceptance where open
        on conflict (course_id,email) do nothing returning id
      ) select open from acceptance`);
      if (!result[0]?.open) throw unavailable();
    });
  }
  async summary() {
    return this.db
      .select({
        courseId: courses.id,
        name: courses.name,
        activeTotal: count(interests.id),
      })
      .from(courses)
      .leftJoin(
        interests,
        and(
          eq(interests.courseId, courses.id),
          eq(interests.status, "ACTIVE"),
          unconsumedInterest(),
        ),
      )
      .groupBy(courses.id, courses.name)
      .orderBy(asc(courses.name), asc(courses.id));
  }
  private async metrics(
    tx: Transaction,
    courseId: string,
  ): Promise<AdminInterestMetricsDto> {
    const result = await tx.execute<{
      preferredGroupId: string | null;
      activeCount: number;
    }>(sql`with buckets as (select null::uuid as id union all select id from groups where course_id = ${courseId}::uuid)
      select buckets.id as "preferredGroupId", count(i.id)::integer as "activeCount" from buckets left join interest_registrations i on i.course_id = ${courseId}::uuid and i.status = 'ACTIVE' and not exists (select 1 from pre_registrations where source_interest_id = i.id) and i.preferred_group_id is not distinct from buckets.id group by buckets.id order by buckets.id nulls first`);
    const byPreference = Array.from(result);
    return {
      courseId,
      activeTotal: byPreference.reduce(
        (sum, bucket) => sum + bucket.activeCount,
        0,
      ),
      byPreference,
    };
  }
  async course(courseId: string, status?: InterestStatus) {
    return this.db.transaction(async (tx) => {
      // Parent share lock holds writes in all cooperating repositories until this consistent read completes.
      const [course] = await tx
        .select({ id: courses.id, name: courses.name })
        .from(courses)
        .where(eq(courses.id, courseId))
        .for("share");
      if (!course) return null;
      const rows = await tx
        .select()
        .from(interests)
        .where(
          and(
            eq(interests.courseId, courseId),
            status ? eq(interests.status, status) : undefined,
            unconsumedInterest(),
          ),
        )
        .orderBy(asc(interests.createdAt), asc(interests.id));
      const historical = await tx
        .select()
        .from(groups)
        .where(eq(groups.courseId, courseId))
        .orderBy(asc(groups.startsAt), asc(groups.id));
      return {
        course,
        registrations: rows.map(dto),
        availableForPrefillInterestIds: rows
          .filter((row) => row.status === "ACTIVE")
          .map((row) => row.id),
        metrics: await this.metrics(tx, courseId),
        groups: historical.map(groupDto),
      };
    });
  }
  async mutate(
    courseId: string,
    input: AdminInterestMutationInput,
    actorId: string,
  ): Promise<AdminInterestPostPayload> {
    return this.db.transaction(async (tx) => {
      const [course] = await tx
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.id, courseId))
        .for("update");
      if (!course) throw notFound();
      const [previous] = await tx
        .select()
        .from(interests)
        .where(
          and(
            eq(interests.id, input.interestRegistrationId),
            eq(interests.courseId, courseId),
            unconsumedInterest(),
          ),
        )
        .for("update");
      if (!previous)
        throw new InterestError(
          "INTEREST_REGISTRATION_NOT_FOUND",
          404,
          "Registro no encontrado.",
        );
      if (previous.updatedAt.toISOString() !== input.revision)
        return {
          ok: false,
          code: "STALE_INTEREST_REGISTRATION",
          message: "El registro cambió. Revisa su estado antes de reintentar.",
          registration: dto(previous),
          metrics: await this.metrics(tx, courseId),
        };
      const status = input.intent === "cancel" ? "CANCELLED" : "ACTIVE";
      let row = previous;
      if (previous.status !== status) {
        const [updated] = await tx
          .update(interests)
          .set({
            status,
            updatedAt: sql`greatest(date_trunc('milliseconds', clock_timestamp()), ${interests.updatedAt} + interval '1 millisecond')`,
          })
          .where(eq(interests.id, previous.id))
          .returning();
        if (!updated) throw new Error("Interest mutation failed");
        row = updated;
        await tx.insert(auditEvents).values({
          actorId,
          action:
            status === "CANCELLED"
              ? "INTEREST_REGISTRATION_CANCELLED"
              : "INTEREST_REGISTRATION_REACTIVATED",
          entityType: "INTEREST_REGISTRATION",
          entityId: row.id,
          metadata: {
            courseId,
            fromStatus: previous.status,
            toStatus: status,
          },
        });
      }
      return {
        ok: true,
        registration: dto(row),
        metrics: await this.metrics(tx, courseId),
      };
    });
  }
}
