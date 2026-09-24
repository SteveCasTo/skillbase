import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { DrizzleCourseRepository } from "@/server/db/repositories/course-repository";
import { DrizzleFormatRepository } from "@/server/db/repositories/format-repository";
import {
  auditEvents,
  courseTypeRevisions,
  courses,
  users,
} from "@/server/db/schema";
import { validateCourseData } from "@/domain/courses/validation";
import { COURSE_FIXTURES } from "../fixtures/courses";

const connection =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const database = createDatabase(connection);
const repository = new DrizzleCourseRepository(database.db);
const formats = new DrizzleFormatRepository(database.db);
let actorId: string;
let formatId: string;
const input = () =>
  validateCourseData({
    ...COURSE_FIXTURES.publishedOpenRegistration,
    courseTypeId: formatId,
  });
const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
};

async function clear() {
  await database.db
    .delete(auditEvents)
    .where(sql`${auditEvents.entityType} in ('COURSE', 'COURSE_TYPE')`);
  await database.db.execute(
    sql`truncate courses, course_type_revisions, course_types`,
  );
  await database.db
    .delete(users)
    .where(eq(users.email, "course.actor@repository.test"));
}
afterAll(async () => {
  await clear();
  await database.close();
});
beforeEach(async () => {
  await clear();
  const [actor] = await database.db
    .insert(users)
    .values({ email: "course.actor@repository.test", name: "Course Actor" })
    .returning();
  if (!actor) throw new Error("Missing actor");
  actorId = actor.id;
  formatId = (
    await formats.create(
      "30 horas",
      { totalHours: 30, studentAmount: "120.00", externalAmount: "150.00" },
      actorId,
    )
  ).id;
});

describe("course format persistence", () => {
  test("revisions are immutable; drafts follow latest while published and archived stay pinned", async () => {
    const draft = await repository.create(input(), actorId);
    const published = await repository.create(
      { ...input(), name: "Published" },
      actorId,
    );
    await repository.transition(published.id, "PUBLISHED", actorId);
    const archived = await repository.create(
      { ...input(), name: "Archived" },
      actorId,
    );
    await repository.transition(archived.id, "ARCHIVED", actorId);
    const revision = await formats.revise(
      formatId,
      { totalHours: 35, studentAmount: "130.00", externalAmount: "155.00" },
      actorId,
    );
    expect(revision.revisionNumber).toBe(2);
    expect((await repository.getAdmin(draft.id))?.totalHours).toBe(35);
    expect((await repository.getAdmin(published.id))?.totalHours).toBe(30);
    expect((await repository.getAdmin(archived.id))?.prices[0]?.amount).toBe(
      "120.00",
    );
    expect(
      await failure(
        database.db
          .update(courseTypeRevisions)
          .set({ totalHours: 100 })
          .where(eq(courseTypeRevisions.id, revision.revisionId)),
      ),
    ).toBeInstanceOf(Error);
    expect(
      await failure(
        database.db
          .delete(courseTypeRevisions)
          .where(eq(courseTypeRevisions.id, revision.revisionId)),
      ),
    ).toBeInstanceOf(Error);
    expect(
      await failure(
        repository.update(draft.id, input(), actorId, draft.updatedAt),
      ),
    ).toMatchObject({ code: "STALE_COURSE" });
    const withdrawn = await repository.transition(
      published.id,
      "DRAFT",
      actorId,
    );
    expect(withdrawn.totalHours).toBe(35);
  });

  test("rejects inactive formats for new and draft assignments without changing historical courses", async () => {
    const course = await repository.create(input(), actorId);
    await repository.transition(course.id, "PUBLISHED", actorId);
    await formats.setActive(formatId, false, actorId);
    expect(await failure(repository.create(input(), actorId))).toMatchObject({
      code: "FORMAT_INACTIVE",
    });
    const draft = await repository.create(
      {
        ...input(),
        courseTypeId: (
          await formats.create(
            "Otro",
            {
              totalHours: 20,
              studentAmount: "80.00",
              externalAmount: "100.00",
            },
            actorId,
          )
        ).id,
      },
      actorId,
    );
    const otherType = draft.courseTypeId;
    await formats.setActive(otherType, false, actorId);
    expect(
      await failure(repository.transition(draft.id, "PUBLISHED", actorId)),
    ).toMatchObject({ code: "FORMAT_INACTIVE" });
    expect((await repository.getPublic(course.slug))?.totalHours).toBe(30);
    expect((await formats.list())[0]?.active).toBe(false);
  });

  test("serializes featured selection and enforces published-only singleton", async () => {
    const first = await repository.create(input(), actorId);
    const second = await repository.create(
      { ...input(), name: "Second" },
      actorId,
    );
    expect(
      await failure(repository.setFeatured(first.id, actorId)),
    ).toMatchObject({ code: "INVALID_TRANSITION" });
    await repository.transition(first.id, "PUBLISHED", actorId);
    await repository.transition(second.id, "PUBLISHED", actorId);
    await Promise.all([
      repository.setFeatured(first.id, actorId),
      repository.setFeatured(second.id, actorId),
    ]);
    expect(
      (await repository.listPublic()).filter((course) => course.featured),
    ).toHaveLength(1);
    expect((await repository.listPublic())[0]?.featured).toBe(true);
    const selected = (await repository.listAdmin()).find(
      (course) => course.featured,
    );
    if (!selected) throw new Error("Missing featured course");
    await repository.transition(selected.id, "DRAFT", actorId);
    expect(
      (await repository.listPublic()).filter((course) => course.featured),
    ).toHaveLength(0);
  });

  test("public projection stays allowlisted and slug/UTC/audit invariants survive", async () => {
    const first = await repository.create(
      { ...input(), contentMarkdown: "**Texto**", instructorName: "Ana" },
      actorId,
    );
    const second = await repository.create(input(), actorId);
    expect(second.slug).toBe(`${first.slug}-2`);
    expect(first.startsAt.toISOString()).toBe("2027-03-01T22:00:00.000Z");
    const changed = await repository.update(
      first.id,
      { ...input(), description: "Edited" },
      actorId,
      first.updatedAt,
    );
    expect(changed.slug).toBe(first.slug);
    expect(
      await failure(
        repository.update(first.id, input(), actorId, first.updatedAt),
      ),
    ).toMatchObject({ code: "STALE_COURSE" });
    expect(await repository.getPublic(first.slug)).toBeNull();
    await repository.transition(first.id, "PUBLISHED", actorId);
    const dto = await repository.getPublic(first.slug);
    expect(dto).toMatchObject({
      prices: [{ amount: "120.00" }, { amount: "150.00" }],
      totalHours: 30,
    });
    for (const field of [
      "id",
      "status",
      "minimumGrade",
      "updatedAt",
      "courseTypeRevisionId",
    ])
      expect(dto).not.toHaveProperty(field);
    expect(
      (
        await database.db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.entityId, first.id))
      ).map((row) => row.action),
    ).toEqual(["COURSE_CREATED", "COURSE_UPDATED", "COURSE_PUBLISHED"]);
  });

  test("DB checks, RLS and grants protect format and featured tables", async () => {
    const course = await repository.create(input(), actorId);
    expect(
      await failure(
        database.db
          .update(courseTypeRevisions)
          .set({ studentAmount: "-1.00" })
          .where(eq(courseTypeRevisions.courseTypeId, formatId)),
      ),
    ).toBeInstanceOf(Error);
    expect(
      await failure(
        database.db
          .update(courses)
          .set({ featured: true })
          .where(eq(courses.id, course.id)),
      ),
    ).toBeInstanceOf(Error);
    const rows = await database.db.execute<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      sql`select relname, relrowsecurity from pg_class where relname in ('course_types','course_type_revisions') and relnamespace = 'public'::regnamespace`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
    for (const name of ["course_types", "course_type_revisions"])
      for (const role of ["anon", "authenticated", "service_role"])
        expect(
          (
            await database.db.execute<{ allowed: boolean }>(
              sql`select has_table_privilege(${role}, ${`public.${name}`}, 'select,insert,update,delete') allowed`,
            )
          )[0]?.allowed,
        ).toBe(false);
  });

  test("format creation rolls back on invalid audit actor", async () => {
    const before = await formats.list();
    expect(
      await failure(
        formats.create(
          "No audit actor",
          { totalHours: 10, studentAmount: "1.00", externalAmount: "2.00" },
          "00000000-0000-4000-8000-000000000099",
        ),
      ),
    ).toBeInstanceOf(Error);
    expect(await formats.list()).toEqual(before);
  });
});
