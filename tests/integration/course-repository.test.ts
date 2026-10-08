import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { DrizzleCourseRepository } from "@/server/db/repositories/course-repository";
import { DrizzleFormatRepository } from "@/server/db/repositories/format-repository";
import { DrizzleGroupRepository } from "@/server/db/repositories/group-repository";
import {
  auditEvents,
  courseTypeRevisions,
  courseTypes,
  courses,
  users,
  userRoles,
} from "@/server/db/schema";
import { validateCourseData } from "@/domain/courses/validation";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import {
  GROUP_SCHEDULE,
  planCourseDates,
  planWeekdaySchedule,
  weekdayMask,
} from "@/domain/courses/weekday-schedule";
import { COURSE_FIXTURES } from "../fixtures/courses";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createInstructorFixture } from "../fixtures/instructors";
import { evaluationFixtureTables } from "../fixtures/evaluation-cleanup";

const connection = getTestSupabaseEnvironment().databaseUrl;
const database = createDatabase(connection);
const repository = new DrizzleCourseRepository(database.db);
const formats = new DrizzleFormatRepository(database.db);
const groupRepository = new DrizzleGroupRepository(database.db);
let actorId: string;
let formatId: string;
let instructorId: string;
const input = () =>
  validateCourseData({
    ...COURSE_FIXTURES.publishedOpenRegistration,
    courseTypeId: formatId,
    instructorId,
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
    .where(
      sql`${auditEvents.entityType} in ('COURSE', 'COURSE_TYPE') or (${auditEvents.entityType} = 'GROUP' and ${auditEvents.actorId} in (select id from users where email = 'course.actor@repository.test'))`,
    );
  await database.db.execute(
    // Runner-owned isolated test database only: explicit fixture cleanup, never
    // the production/local demo reset allowlist and never CASCADE.
    sql`truncate ${evaluationFixtureTables}, participant_attendance, instructor_attendance, session_roster, attendance_command_receipts, group_sessions, registration_ledger, pre_registrations, registration_command_receipts, participants, registration_settings, interest_registrations, course_instructor_history, groups, courses, course_type_revisions, course_types RESTRICT`,
  );
  await database.db.execute(
    sql`insert into registration_settings (id) values (1)`,
  );
  await database.db
    .delete(users)
    .where(
      sql`${users.email} in ('course.actor@repository.test', 'other.course.actor@repository.test')`,
    );
}
afterAll(async () => {
  await clear();
  await database.close();
});
beforeEach(async () => {
  await clear();
  instructorId = (await createInstructorFixture(database.db)).id;
  const [actor] = await database.db
    .insert(users)
    .values({
      email: "course.actor@repository.test",
      name: "Course Actor",
      status: "ACTIVE",
      authUserId: crypto.randomUUID(),
    })
    .returning();
  if (!actor) throw new Error("Missing actor");
  actorId = actor.id;
  await database.db
    .insert(userRoles)
    .values({ userId: actorId, roleCode: "ADMIN" });
  formatId = (
    await formats.create(
      "30 horas",
      {
        totalHours: 30,
        sessionMinutes: 150,
        studentAmount: "120.00",
        externalAmount: "150.00",
      },
      actorId,
    )
  ).id;
});

describe("course format persistence", () => {
  test("creation receipts roll back with a failed insert and allow a corrected retry", async () => {
    const key = crypto.randomUUID();
    expect(
      await failure(
        repository.create({ ...input(), minimumGrade: 101 }, actorId, {
          key,
          fingerprint: "a".repeat(64),
        }),
      ),
    ).not.toBeNull();
    expect(await repository.listAdmin()).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "COURSE_CREATED")),
    ).toHaveLength(0);
    const retry = await repository.create(input(), actorId, {
      key,
      fingerprint: "b".repeat(64),
    });
    expect(await repository.listAdmin()).toHaveLength(1);
    expect((await repository.getAdmin(retry.id))?.minimumGrade).toBe(
      input().minimumGrade,
    );
  });
  test("creation receipts are atomic, actor-scoped and reject changed fingerprints", async () => {
    const key = crypto.randomUUID();
    const request = { key, fingerprint: "a".repeat(64) };
    const [first, replay] = await Promise.all([
      repository.create(input(), actorId, request),
      repository.create(input(), actorId, request),
    ]);
    expect(replay.id).toBe(first.id);
    const edited = await repository.update(
      first.id,
      { ...input(), description: "Changed after initial creation" },
      actorId,
      first.updatedAt,
    );
    const recovered = await repository.create(input(), actorId, request);
    expect(recovered.creationRevision?.getTime()).toBe(
      first.updatedAt.getTime(),
    );
    expect(recovered.updatedAt.getTime()).toBe(edited.updatedAt.getTime());
    expect(recovered.description).toBe("Changed after initial creation");
    expect(await repository.listAdmin()).toHaveLength(1);
    expect(
      await failure(
        repository.create(input(), actorId, {
          key,
          fingerprint: "b".repeat(64),
        }),
      ),
    ).toMatchObject({ code: "VALIDATION_FAILED" });
    const [other] = await database.db
      .insert(users)
      .values({
        email: "other.course.actor@repository.test",
        name: "Other actor",
        status: "ACTIVE",
        authUserId: crypto.randomUUID(),
      })
      .returning();
    if (!other) throw new Error("Missing actor");
    await database.db
      .insert(userRoles)
      .values({ userId: other.id, roleCode: "ADMIN" });
    const independent = await repository.create(input(), other.id, request);
    expect(independent.id).not.toBe(first.id);
    expect("createFingerprint" in first).toBe(false);
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "COURSE_CREATED"));
    expect(audits).toHaveLength(2);
  });

  test("editorial transitions and featuring reject stale revisions under the row lock", async () => {
    const created = await repository.create(input(), actorId);
    const changed = await repository.update(
      created.id,
      { ...input(), description: "New description" },
      actorId,
      created.updatedAt,
    );
    expect(
      await failure(
        repository.transition(
          created.id,
          "PUBLISHED",
          actorId,
          created.updatedAt,
        ),
      ),
    ).toMatchObject({ code: "STALE_COURSE" });
    await groupRepository.create(created.id, "08:00", 1, actorId);
    const published = await repository.transition(
      created.id,
      "PUBLISHED",
      actorId,
      changed.updatedAt,
    );
    expect(
      await failure(
        repository.setFeatured(created.id, actorId, changed.updatedAt),
      ),
    ).toMatchObject({ code: "STALE_COURSE" });
    expect(
      await failure(
        repository.transition(
          created.id,
          "ARCHIVED",
          actorId,
          changed.updatedAt,
        ),
      ),
    ).toMatchObject({ code: "STALE_COURSE" });
    expect((await repository.getAdmin(created.id))?.status).toBe("PUBLISHED");
    await repository.setFeatured(created.id, actorId, published.updatedAt);
  });
  test("editorial transitions and saves sharing one revision cannot both commit", async () => {
    const created = await repository.create(input(), actorId);
    await groupRepository.create(created.id, "08:00", 1, actorId);
    const outcomes = await Promise.allSettled([
      repository.transition(
        created.id,
        "PUBLISHED",
        actorId,
        created.updatedAt,
      ),
      repository.update(
        created.id,
        { ...input(), description: "Concurrent save" },
        actorId,
        created.updatedAt,
      ),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    if (rejected?.status !== "rejected")
      throw new Error("Missing optimistic rejection");
    expect(rejected.reason).toMatchObject({ code: "STALE_COURSE" });
  });
  test("keeps historical text-only courses editable when their format gains session minutes", async () => {
    const legacy = await formats.create(
      "Legacy",
      { totalHours: 20, studentAmount: "80.00", externalAmount: "100.00" },
      actorId,
    );
    const oldInput = {
      ...COURSE_FIXTURES.draftWithoutRegistration,
      weekdays: undefined,
    };
    const created = await repository.create(
      validateCourseData({ ...oldInput, courseTypeId: legacy.id }),
      actorId,
    );
    await formats.revise(
      legacy.id,
      {
        totalHours: 20,
        sessionMinutes: 90,
        studentAmount: "80.00",
        externalAmount: "100.00",
      },
      actorId,
    );
    const latest = await repository.getAdmin(created.id);
    expect(latest?.weekdaysMask).toBeNull();
    expect(latest?.sessionMinutes).toBe(90);
    expect(
      await repository.update(
        created.id,
        validateCourseData({
          ...oldInput,
          courseTypeId: legacy.id,
          description: "Edited legacy",
        }),
        actorId,
        latest!.updatedAt,
      ),
    ).toMatchObject({
      description: "Edited legacy",
      schedule: oldInput.schedule,
    });
  });
  test("versioned migration backfills only exact seed terms, preserving ambiguous legacy revisions", async () => {
    const migration = readFileSync(
      new URL("../../drizzle/0006_icy_unus.sql", import.meta.url),
      "utf8",
    );
    const update = migration
      .split("--> statement-breakpoint")
      .find((statement) =>
        statement.trimStart().startsWith("UPDATE course_type_revisions"),
      );
    if (!update) throw new Error("Missing migration backfill");
    await database.db
      .transaction(async (tx) => {
        const [sample, ambiguous, sample30] = await tx
          .insert(courseTypes)
          .values([
            { name: "Formato 20 horas" },
            { name: "Legacy 20h" },
            { name: "Formato 30 horas" },
          ])
          .returning();
        if (!sample || !ambiguous || !sample30)
          throw new Error("Missing legacy types");
        const rows = await tx
          .insert(courseTypeRevisions)
          .values([
            {
              courseTypeId: sample.id,
              revisionNumber: 1,
              totalHours: 20,
              studentAmount: "80.00",
              externalAmount: "100.00",
            },
            {
              courseTypeId: ambiguous.id,
              revisionNumber: 1,
              totalHours: 20,
              studentAmount: "80.00",
              externalAmount: "100.00",
            },
            {
              courseTypeId: sample.id,
              revisionNumber: 2,
              totalHours: 30,
              studentAmount: "120.00",
              externalAmount: "150.00",
            },
            {
              courseTypeId: sample30.id,
              revisionNumber: 1,
              totalHours: 30,
              studentAmount: "120.00",
              externalAmount: "150.00",
            },
          ])
          .returning();
        await tx.execute(
          sql`ALTER TABLE course_type_revisions DISABLE TRIGGER course_type_revisions_immutable`,
        );
        await tx.execute(sql.raw(update));
        await tx.execute(
          sql`ALTER TABLE course_type_revisions ENABLE TRIGGER course_type_revisions_immutable`,
        );
        const result = await tx.select().from(courseTypeRevisions);
        expect(result.find((r) => r.id === rows[0]?.id)?.sessionMinutes).toBe(
          90,
        );
        expect(
          result.find((r) => r.id === rows[1]?.id)?.sessionMinutes,
        ).toBeNull();
        expect(
          result.find((r) => r.id === rows[2]?.id)?.sessionMinutes,
        ).toBeNull();
        expect(result.find((r) => r.id === rows[3]?.id)?.sessionMinutes).toBe(
          150,
        );
        tx.rollback();
      })
      .catch((error: unknown) => {
        // Drizzle rollback rejects with its own rollback marker.
        if (!(error instanceof Error) || error.message !== "Rollback")
          throw error;
      });
  });
  test("persists resolved session minutes per immutable revision and checks structured schedules", async () => {
    const format = await formats.revise(
      formatId,
      {
        totalHours: 20,
        sessionMinutes: 90,
        studentAmount: "80.00",
        externalAmount: "100.00",
      },
      actorId,
    );
    const plan = planWeekdaySchedule({
      startsAt: "2027-03-01T18:00",
      weekdaysMask: weekdayMask([1, 2, 3, 4, 5]),
      totalHours: 20,
      sessionMinutes: 90,
    });
    const data = validateCourseData({
      ...COURSE_FIXTURES.publishedOpenRegistration,
      courseTypeId: formatId,
      weekdays: "1,2,3,4,5",
      instructorId,
      schedule: "Lunes a viernes, 18:00–19:30",
      startsAt: "2027-03-01T18:00",
      endsAt: "2027-03-17T19:30",
    });
    const course = await repository.create(data, actorId);
    expect(course.weekdaysMask).toBe(31);
    expect(course.sessionMinutes).toBe(90);
    expect(course.endsAt).toEqual(plan.endsAt);
    expect(
      await failure(
        repository.create(
          { ...data, name: "Wrong schedule", schedule: "Viernes, 18:00–19:30" },
          actorId,
        ),
      ),
    ).toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { schedule: "Usa el horario calculado." },
    });
    await groupRepository.create(course.id, "08:00", 1, actorId);
    await repository.transition(course.id, "PUBLISHED", actorId);
    await formats.revise(
      formatId,
      {
        totalHours: 30,
        sessionMinutes: 150,
        studentAmount: "120.00",
        externalAmount: "150.00",
      },
      actorId,
    );
    expect((await repository.getAdmin(course.id))?.sessionMinutes).toBe(90);
    expect((await repository.getPublic(course.slug))?.sessionMinutes).toBe(90);
    expect(
      await failure(
        repository.create(
          {
            ...data,
            name: "Wrong end",
            endsAt: new Date("2027-04-01T23:30:00Z"),
          },
          actorId,
        ),
      ),
    ).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(
      await failure(
        repository.create(
          { ...data, name: "Wrong window", registrationEndAt: data.startsAt },
          actorId,
        ),
      ),
    ).toMatchObject({ code: "VALIDATION_FAILED" });
    const [stored] = await database.db
      .select()
      .from(courseTypeRevisions)
      .where(eq(courseTypeRevisions.id, format.revisionId));
    expect(stored?.sessionMinutes).toBe(90);
  });

  test("format revision replans structured drafts but not published courses", async () => {
    await formats.revise(
      formatId,
      {
        totalHours: 20,
        sessionMinutes: 90,
        studentAmount: "80.00",
        externalAmount: "100.00",
      },
      actorId,
    );
    const data = validateCourseData({
      ...COURSE_FIXTURES.publishedOpenRegistration,
      courseTypeId: formatId,
      weekdays: "1,2,3,4,5",
      schedule: "Lunes a viernes, 18:00–19:30",
      startsAt: "2027-03-01T18:00",
      endsAt: "2027-03-17T19:30",
    });
    const draft = await repository.create(data, actorId);
    const next = await formats.revise(
      formatId,
      {
        totalHours: 30,
        sessionMinutes: 150,
        studentAmount: "120.00",
        externalAmount: "150.00",
      },
      actorId,
    );
    expect(next.sessionMinutes).toBe(150);
    const planned = planWeekdaySchedule({
      startsAt: "2027-03-01T18:00",
      weekdaysMask: 31,
      totalHours: 30,
      sessionMinutes: 150,
    });
    expect((await repository.getAdmin(draft.id))?.endsAt).toEqual(
      planned.endsAt,
    );
    expect((await repository.getAdmin(draft.id))?.schedule).toBe(
      "Lunes a viernes, 18:00–20:30",
    );
    expect((await repository.getAdmin(draft.id))?.sessionMinutes).toBe(150);
  });
  test("replans ungrouped draft dates without inventing a shared group hour", async () => {
    const initial = planCourseDates({
      startDate: "2027-03-01",
      weekdaysMask: 31,
      totalHours: 30,
      sessionMinutes: 150,
    });
    const course = await repository.create(
      validateCourseData({
        ...COURSE_FIXTURES.publishedOpenRegistration,
        courseTypeId: formatId,
        weekdays: "1,2,3,4,5",
        schedule: GROUP_SCHEDULE,
        startsAt: "2027-03-01T00:00",
        endsAt: "2027-03-16T23:59",
      }),
      actorId,
    );
    expect(course.endsAt).toEqual(initial.endsAt);
    await formats.revise(
      formatId,
      {
        totalHours: 20,
        sessionMinutes: 90,
        studentAmount: "80.00",
        externalAmount: "100.00",
      },
      actorId,
    );
    const expected = planCourseDates({
      startDate: "2027-03-01",
      weekdaysMask: 31,
      totalHours: 20,
      sessionMinutes: 90,
    });
    const updated = await repository.getAdmin(course.id);
    expect(updated?.endsAt).toEqual(expected.endsAt);
    expect(updated?.schedule).toBe(GROUP_SCHEDULE);
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(
      course.updatedAt.getTime(),
    );
  });
  test("a first group pins the course plan during a concurrent format revision", async () => {
    const plan = planCourseDates({
      startDate: "2027-03-01",
      weekdaysMask: 31,
      totalHours: 30,
      sessionMinutes: 150,
    });
    const course = await repository.create(
      validateCourseData({
        ...COURSE_FIXTURES.publishedOpenRegistration,
        courseTypeId: formatId,
        weekdays: "1,2,3,4,5",
        schedule: GROUP_SCHEDULE,
        startsAt: "2027-03-01T00:00",
        endsAt: "2027-03-16T23:59",
      }),
      actorId,
    );
    expect(course.endsAt).toEqual(plan.endsAt);
    const groupsRepo = new DrizzleGroupRepository(database.db);
    const [groupResult, revisionResult] = await Promise.allSettled([
      groupsRepo.create(course.id, "08:00", 10, actorId),
      formats.revise(
        formatId,
        {
          totalHours: 20,
          sessionMinutes: 90,
          studentAmount: "80.00",
          externalAmount: "100.00",
        },
        actorId,
      ),
    ]);
    expect(groupResult.status).toBe("fulfilled");
    expect(revisionResult.status).toBe("fulfilled");
    if (groupResult.status !== "fulfilled") return;
    const stored = await repository.getAdmin(course.id);
    expect(stored).not.toBeNull();
    if (!stored) return;
    expect(groupResult.value.courseTypeRevisionId).toBe(
      stored.courseTypeRevisionId,
    );
    expect(instantToBoliviaCivil(groupResult.value.endsAt).slice(0, 10)).toBe(
      instantToBoliviaCivil(stored.endsAt).slice(0, 10),
    );
  });
  test("keeps the format and first-group plan consistent in either operation order", async () => {
    const groupsRepo = new DrizzleGroupRepository(database.db);
    for (const order of ["format-first", "group-first"] as const) {
      const format = await formats.create(
        `Interleaving ${order}`,
        {
          totalHours: 30,
          sessionMinutes: 150,
          studentAmount: "120.00",
          externalAmount: "150.00",
        },
        actorId,
      );
      const course = await repository.create(
        validateCourseData({
          ...COURSE_FIXTURES.publishedOpenRegistration,
          name: `Interleaving course ${order}`,
          courseTypeId: format.id,
          weekdays: "1,2,3,4,5",
          schedule: GROUP_SCHEDULE,
          startsAt: "2027-03-01T00:00",
          endsAt: "2027-03-16T23:59",
        }),
        actorId,
      );
      const revise = () =>
        formats.revise(
          format.id,
          {
            totalHours: 20,
            sessionMinutes: 90,
            studentAmount: "80.00",
            externalAmount: "100.00",
          },
          actorId,
        );
      if (order === "format-first") {
        await revise();
        await groupsRepo.create(course.id, "08:00", 10, actorId);
      } else {
        await groupsRepo.create(course.id, "08:00", 10, actorId);
        await revise();
      }
      const stored = await repository.getAdmin(course.id);
      const [group] = await groupsRepo.list(course.id);
      expect(stored).not.toBeNull();
      expect(group).toMatchObject({
        courseTypeRevisionId: stored!.courseTypeRevisionId,
      });
      expect(instantToBoliviaCivil(group!.endsAt).slice(0, 10)).toBe(
        instantToBoliviaCivil(stored!.endsAt).slice(0, 10),
      );
    }
  });
  test("stores course revision timestamps at the browser's millisecond precision", async () => {
    const [column] = await database.db.execute(sql`
      select datetime_precision as precision from information_schema.columns
      where table_schema = 'public' and table_name = 'courses' and column_name = 'updated_at'
    `);
    expect(column?.precision).toBe(3);
    const created = await repository.create(input(), actorId);
    const edited = await repository.update(
      created.id,
      { ...input(), description: "Edited with a browser revision" },
      actorId,
      new Date(created.updatedAt.toISOString()),
    );
    expect(edited.description).toBe("Edited with a browser revision");
    const [stored] = await database.db.execute(sql`
      select updated_at = date_trunc('milliseconds', updated_at) as exact
      from courses where id = ${created.id}
    `);
    expect(stored?.exact).toBe(true);
    expect(
      await failure(
        repository.update(created.id, input(), actorId, created.updatedAt),
      ),
    ).toMatchObject({ code: "STALE_COURSE" });
  });
  test("revisions are immutable; drafts follow latest while published and archived stay pinned", async () => {
    const draft = await repository.create(input(), actorId);
    const published = await repository.create(
      { ...input(), name: "Published" },
      actorId,
    );
    await groupRepository.create(published.id, "08:00", 1, actorId);
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
    // Publication now requires a group, which pins this course's revision even after withdrawal.
    expect(withdrawn.totalHours).toBe(30);
    expect(withdrawn.courseTypeRevisionId).toBe(published.courseTypeRevisionId);
  });

  test("rejects inactive formats for new and draft assignments without changing historical courses", async () => {
    const course = await repository.create(input(), actorId);
    await groupRepository.create(course.id, "08:00", 1, actorId);
    await repository.transition(course.id, "PUBLISHED", actorId);
    await formats.setActive(formatId, false, actorId);
    expect(await failure(repository.create(input(), actorId))).toMatchObject({
      code: "FORMAT_INACTIVE",
    });
    const draft = await repository.create(
      {
        ...input(),
        schedule: "Lunes a viernes, 18:00–19:30",
        endsAt: planWeekdaySchedule({
          startsAt: "2027-03-01T18:00",
          weekdaysMask: 31,
          totalHours: 20,
          sessionMinutes: 90,
        }).endsAt,
        courseTypeId: (
          await formats.create(
            "Otro",
            {
              totalHours: 20,
              sessionMinutes: 90,
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
    await groupRepository.create(draft.id, "11:00", 1, actorId);
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
    await groupRepository.create(first.id, "08:00", 1, actorId);
    await groupRepository.create(second.id, "11:00", 1, actorId);
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
    await groupRepository.create(first.id, "08:00", 1, actorId);
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
    const courseAuditEvents = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, first.id));
    // PostgreSQL does not guarantee row order without ORDER BY. These writes
    // can share a transaction timestamp, so assert the exact event set/count,
    // not an incidental order from the query plan.
    expect(courseAuditEvents).toHaveLength(3);
    expect(courseAuditEvents.map((row) => row.action).sort()).toEqual(
      ["COURSE_CREATED", "COURSE_PUBLISHED", "COURSE_UPDATED"].sort(),
    );
    expect(
      courseAuditEvents.every(
        (row) =>
          row.actorId === actorId &&
          row.entityType === "COURSE" &&
          row.entityId === first.id,
      ),
    ).toBe(true);
    expect(
      courseAuditEvents.find((row) => row.action === "COURSE_CREATED")
        ?.metadata,
    ).toEqual({ slug: first.slug });
    expect(
      courseAuditEvents.find((row) => row.action === "COURSE_PUBLISHED")
        ?.metadata,
    ).toEqual({ from: "DRAFT", to: "PUBLISHED" });
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

  test("deleting an unused format removes its revisions and records an audit", async () => {
    await formats.revise(
      formatId,
      { totalHours: 35, studentAmount: "130.00", externalAmount: "155.00" },
      actorId,
    );
    const revisions = await database.db
      .select()
      .from(courseTypeRevisions)
      .where(eq(courseTypeRevisions.courseTypeId, formatId));
    const format = await formats.get(formatId);
    if (!format) throw new Error("Missing format");

    await formats.delete(
      formatId,
      format.revisionId,
      format.updatedAt,
      actorId,
    );

    expect(await formats.get(formatId)).toBeNull();
    expect(
      await database.db
        .select()
        .from(courseTypeRevisions)
        .where(eq(courseTypeRevisions.courseTypeId, formatId)),
    ).toHaveLength(0);
    expect(revisions).toHaveLength(2);
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, formatId)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "COURSE_TYPE_DELETED",
          actorId,
          entityType: "COURSE_TYPE",
        }),
      ]),
    );
  });

  test("assigned formats cannot be deleted but can be deactivated", async () => {
    await repository.create(input(), actorId);
    const format = await formats.get(formatId);
    if (!format) throw new Error("Missing format");

    expect(
      await failure(
        formats.delete(formatId, format.revisionId, format.updatedAt, actorId),
      ),
    ).toMatchObject({ code: "INVALID_TRANSITION" });
    expect(await formats.get(formatId)).toMatchObject({
      id: formatId,
      used: true,
    });

    const deactivated = await formats.setActive(formatId, false, actorId);
    expect(deactivated).toMatchObject({
      id: formatId,
      active: false,
      used: true,
    });
    expect(await formats.get(formatId)).toMatchObject({
      id: formatId,
      active: false,
      used: true,
    });
  });
});
