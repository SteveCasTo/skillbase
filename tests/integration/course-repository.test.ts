import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { validateCourseData } from "@/domain/courses/validation";
import { createDatabase } from "@/server/db/client";
import { DrizzleCourseRepository } from "@/server/db/repositories/course-repository";
import { auditEvents, coursePrices, courses, users } from "@/server/db/schema";
import { COURSE_FIXTURES } from "../fixtures/courses";

const database = createDatabase(
  process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
);
const repository = new DrizzleCourseRepository(database.db);
let actorId = "";
const input = validateCourseData(COURSE_FIXTURES.publishedOpenRegistration);

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

afterAll(async () => database.close());
beforeEach(async () => {
  await database.db
    .delete(auditEvents)
    .where(eq(auditEvents.entityType, "COURSE"));
  await database.db.delete(coursePrices);
  await database.db.delete(courses);
  await database.db
    .delete(users)
    .where(eq(users.email, "course.actor@repository.test"));
  const [actor] = await database.db
    .insert(users)
    .values({ email: "course.actor@repository.test", name: "Course Actor" })
    .returning();
  if (!actor) throw new Error("Actor fixture missing");
  actorId = actor.id;
});

describe("course repository", () => {
  test("creates prices and audit atomically, generates unique immutable slugs", async () => {
    const first = await repository.create(input, actorId);
    const second = await repository.create(input, actorId);
    expect(first.slug).toBe("course-repository-test");
    expect(second.slug).toBe("course-repository-test-2");
    expect(first.prices).toHaveLength(2);
    const updated = await repository.update(
      first.id,
      {
        ...input,
        name: "Renamed",
        prices: input.prices.map((price) =>
          price.participantType === "STUDENT"
            ? { ...price, amount: "125.00" }
            : price,
        ),
      },
      actorId,
      first.updatedAt,
    );
    expect(updated.slug).toBe(first.slug);
    expect(
      (
        await database.db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.entityId, first.id))
      ).map(({ action }) => action),
    ).toEqual(["COURSE_CREATED", "COURSE_UPDATED", "COURSE_PRICES_UPDATED"]);
  });

  test("publishes, withdraws, archives and filters public DTOs", async () => {
    const draft = await repository.create(input, actorId);
    expect(await repository.listPublic()).toEqual([]);
    const published = await repository.transition(
      draft.id,
      "PUBLISHED",
      actorId,
    );
    await repository.update(
      draft.id,
      { ...input, description: "Published content can be edited safely." },
      actorId,
      published.updatedAt,
    );
    const publicCourse = await repository.getPublic(
      draft.slug,
      new Date("2027-01-15T00:00:00Z"),
    );
    expect(publicCourse).toMatchObject({
      slug: draft.slug,
      description: "Published content can be edited safely.",
      registrationAvailability: "OPEN",
    });
    expect(publicCourse).not.toHaveProperty("id");
    expect(publicCourse).not.toHaveProperty("status");
    expect(publicCourse).not.toHaveProperty("minimumGrade");
    expect(publicCourse).not.toHaveProperty("createdAt");
    await repository.transition(draft.id, "DRAFT", actorId);
    expect(await repository.getPublic(draft.slug)).toBeNull();
    await repository.transition(draft.id, "ARCHIVED", actorId);
    expect(await repository.listPublic()).toEqual([]);
    expect(
      await rejectedValue(
        repository.update(draft.id, input, actorId, draft.updatedAt),
      ),
    ).toMatchObject({ code: "COURSE_ARCHIVED" });
  });

  test("rolls back course and prices when audit actor is invalid", async () => {
    expect(
      await rejectedValue(
        repository.create(input, "00000000-0000-4000-8000-000000000099"),
      ),
    ).toBeInstanceOf(Error);
    expect(await database.db.select().from(courses)).toHaveLength(0);
    expect(await database.db.select().from(coursePrices)).toHaveLength(0);
  });

  test("enforces checks, indexed foreign keys, RLS and least privilege", async () => {
    expect(
      await rejectedValue(
        database.db
          .insert(courses)
          .values({
            name: input.name,
            slug: "invalid slug",
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
          })
          .execute(),
      ),
    ).toBeInstanceOf(Error);
    const valid = await repository.create(input, actorId);
    const invalidWrites: ReadonlyArray<() => Promise<unknown>> = [
      () =>
        database.db
          .update(courses)
          .set({ totalHours: 0 })
          .where(eq(courses.id, valid.id))
          .execute(),
      () =>
        database.db
          .update(courses)
          .set({ minimumGrade: 101 })
          .where(eq(courses.id, valid.id))
          .execute(),
      () =>
        database.db
          .update(courses)
          .set({ endsAt: input.startsAt })
          .where(eq(courses.id, valid.id))
          .execute(),
      () =>
        database.db
          .update(courses)
          .set({ registrationEndAt: null })
          .where(eq(courses.id, valid.id))
          .execute(),
      () =>
        database.db
          .insert(coursePrices)
          .values({
            courseId: valid.id,
            participantType: "STUDENT",
            amount: "1.00",
            currency: "BOB",
          })
          .execute(),
      () =>
        database.db
          .insert(coursePrices)
          .values({
            courseId: "00000000-0000-4000-8000-000000000099",
            participantType: "STUDENT",
            amount: "1.00",
            currency: "BOB",
          })
          .execute(),
      () =>
        database.db
          .update(coursePrices)
          .set({ amount: "-0.01" })
          .where(eq(coursePrices.courseId, valid.id))
          .execute(),
      () =>
        database.db
          .update(coursePrices)
          .set({ currency: "USD" })
          .where(eq(coursePrices.courseId, valid.id))
          .execute(),
    ];
    for (const write of invalidWrites)
      expect(await rejectedValue(write())).toBeInstanceOf(Error);
    const indexes = await database.db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public' and indexname in ('course_prices_course_id_idx', 'audit_events_actor_id_idx', 'courses_status_idx', 'courses_slug_unique')`,
    );
    expect(indexes).toHaveLength(4);
    const rls = await database.db.execute<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      sql`select relname, relrowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relname in ('courses', 'course_prices', 'audit_events') order by relname`,
    );
    expect(rls).toHaveLength(3);
    expect(rls.every(({ relrowsecurity }) => relrowsecurity)).toBe(true);
    for (const table of ["courses", "course_prices", "audit_events"])
      for (const role of ["anon", "authenticated", "service_role"])
        expect(
          (
            await database.db.execute<{ allowed: boolean }>(
              sql`select has_table_privilege(${role}, ${`public.${table}`}, 'select,insert,update,delete') as allowed`,
            )
          )[0]?.allowed,
        ).toBe(false);
  });

  test("persists Bolivia civil datetimes as UTC and returns them without displacement", async () => {
    const created = await repository.create(input, actorId);
    expect(created.startsAt.toISOString()).toBe("2027-03-01T22:00:00.000Z");
    expect(created.registrationStartAt?.toISOString()).toBe(
      "2027-01-01T16:00:00.000Z",
    );
    const reloaded = await repository.getAdmin(created.id);
    expect(reloaded?.startsAt.toISOString()).toBe("2027-03-01T22:00:00.000Z");
  });

  test("serializes overlapping slug bases under concurrent creation", async () => {
    const firstDatabase = createDatabase(
      process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    );
    const secondDatabase = createDatabase(
      process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    );
    try {
      const [first, second] = await Promise.all([
        new DrizzleCourseRepository(firstDatabase.db).create(
          { ...input, name: "Foo" },
          actorId,
        ),
        new DrizzleCourseRepository(secondDatabase.db).create(
          { ...input, name: "Foo 2" },
          actorId,
        ),
      ]);
      expect([first.slug, second.slug].sort()).toEqual(["foo", "foo-2"]);
    } finally {
      await firstDatabase.close();
      await secondDatabase.close();
    }
  });

  test("rejects publication unless exactly both required BOB prices exist", async () => {
    const draft = await repository.create(input, actorId);
    await database.db
      .delete(coursePrices)
      .where(
        sql`${coursePrices.courseId} = ${draft.id} and ${coursePrices.participantType} = 'EXTERNAL'`,
      );
    expect(
      await rejectedValue(
        repository.transition(draft.id, "PUBLISHED", actorId),
      ),
    ).toMatchObject({ code: "COURSE_PRICES_INCOMPLETE" });
    expect((await repository.getAdmin(draft.id))?.status).toBe("DRAFT");
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, draft.id)),
    ).toHaveLength(1);
  });

  test("uses optimistic revisions and never overwrites a stale edit", async () => {
    const original = await repository.create(input, actorId);
    const first = await repository.update(
      original.id,
      { ...input, description: "First accepted edit" },
      actorId,
      original.updatedAt,
    );
    expect(
      await rejectedValue(
        repository.update(
          original.id,
          { ...input, description: "Stale overwrite" },
          actorId,
          original.updatedAt,
        ),
      ),
    ).toMatchObject({ code: "STALE_COURSE" });
    expect((await repository.getAdmin(original.id))?.description).toBe(
      "First accepted edit",
    );
    expect(first.updatedAt.getTime()).toBeGreaterThan(
      original.updatedAt.getTime(),
    );
  });

  test("audits only real field and exact price changes", async () => {
    const original = await repository.create(input, actorId);
    const unchanged = await repository.update(
      original.id,
      input,
      actorId,
      original.updatedAt,
    );
    expect(unchanged.updatedAt).toEqual(original.updatedAt);
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, original.id)),
    ).toHaveLength(1);

    await repository.update(
      original.id,
      {
        ...input,
        prices: input.prices.map((price) =>
          price.participantType === "STUDENT"
            ? { ...price, amount: "121.00" }
            : price,
        ),
      },
      actorId,
      original.updatedAt,
    );
    const events = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, original.id));
    expect(events.map(({ action }) => action)).toEqual([
      "COURSE_CREATED",
      "COURSE_PRICES_UPDATED",
    ]);
    expect(events[1]?.metadata).toEqual({ participantTypes: "STUDENT" });
  });
});
