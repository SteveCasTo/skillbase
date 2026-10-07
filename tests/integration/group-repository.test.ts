import { afterAll, beforeEach, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { DrizzleGroupRepository } from "@/server/db/repositories/group-repository";
import { DrizzleCourseRepository } from "@/server/db/repositories/course-repository";
import { DrizzleFormatRepository } from "@/server/db/repositories/format-repository";
import {
  auditEvents,
  courseTypeRevisions,
  courses,
  groups,
  users,
  userRoles,
} from "@/server/db/schema";
import { validateCourseData } from "@/domain/courses/validation";
import {
  GROUP_SCHEDULE,
  planCourseDates,
  planWeekdaySchedule,
} from "@/domain/courses/weekday-schedule";
import {
  createGroup,
  changeGroupSchedule,
  changeGroupCapacity,
  cancelGroup,
  deleteGroup,
  listGroups,
  reactivateGroup,
} from "@/application/groups/manage-groups";
import type { InternalUser } from "@/domain/auth/types";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { COURSE_FIXTURES } from "../fixtures/courses";
import { createInstructorFixture } from "../fixtures/instructors";

const database = createDatabase(getTestSupabaseEnvironment().databaseUrl, {
  max: 8,
});
const repo = new DrizzleGroupRepository(database.db);
const courseRepo = new DrizzleCourseRepository(database.db);
const formats = new DrizzleFormatRepository(database.db);
let admin: InternalUser;
let courseId: string;
let prerequisiteGroupId: string;

beforeEach(async () => {
  const instructor = await createInstructorFixture(database.db);
  const [actor] = await database.db
    .insert(users)
    .values({
      email: `group-${crypto.randomUUID()}@test.invalid`,
      name: "Group Actor",
      authUserId: crypto.randomUUID(),
      status: "ACTIVE",
    })
    .returning();
  if (!actor) throw new Error("No actor");
  admin = { ...actor, roles: ["ADMIN"] };
  await database.db
    .insert(userRoles)
    .values({ userId: actor.id, roleCode: "ADMIN" });
  const format = await formats.create(
    `Groups ${crypto.randomUUID()}`,
    {
      totalHours: 20,
      sessionMinutes: 90,
      studentAmount: "80.00",
      externalAmount: "100.00",
    },
    actor.id,
  );
  const plan = planWeekdaySchedule({
    startsAt: "2027-03-01T18:00",
    weekdaysMask: 31,
    totalHours: 20,
    sessionMinutes: 90,
  });
  const course = await courseRepo.create(
    validateCourseData({
      ...COURSE_FIXTURES.publishedOpenRegistration,
      name: `Groups ${crypto.randomUUID()}`,
      courseTypeId: format.id,
      instructorId: instructor.id,
      startsAt: "2027-03-01T18:00",
      endsAt: "2027-03-17T19:30",
      schedule: "Lunes a viernes, 18:00–19:30",
      registrationStartAt: "2027-01-01T08:00",
      registrationEndAt: "2027-02-28T12:00",
    }),
    actor.id,
  );
  expect(course.endsAt).toEqual(plan.endsAt);
  prerequisiteGroupId = (await repo.create(course.id, "18:00", 1, actor.id)).id;
  await courseRepo.transition(course.id, "PUBLISHED", actor.id);
  courseId = course.id;
});

afterAll(async () => {
  await database.close();
});

test("adjacency and other courses work; updates, cancellation and audit retain history", async () => {
  const first = await createGroup(repo, admin, courseId, "08:00", 1);
  const second = await createGroup(repo, admin, courseId, "09:30", 15);
  expect(first.courseTypeRevisionId).toBe(second.courseTypeRevisionId);
  expect(await listGroups(repo, admin, courseId)).toHaveLength(3);
  await expect(
    createGroup(repo, admin, courseId, "09:00", 5),
  ).rejects.toMatchObject({ code: "SCHEDULE_CONFLICT" });
  await expect(
    changeGroupSchedule(
      repo,
      admin,
      second.id,
      "08:30",
      second.updatedAt.toISOString(),
    ),
  ).rejects.toMatchObject({ code: "SCHEDULE_CONFLICT" });
  const updated = await changeGroupCapacity(
    repo,
    admin,
    first.id,
    3,
    first.updatedAt.toISOString(),
  );
  await expect(
    cancelGroup(repo, admin, first.id, first.updatedAt.toISOString()),
  ).rejects.toMatchObject({ code: "STALE_GROUP" });
  const cancelled = await cancelGroup(
    repo,
    admin,
    first.id,
    updated.updatedAt.toISOString(),
  );
  expect(cancelled.status).toBe("CANCELLED");
  await expect(
    changeGroupCapacity(
      repo,
      admin,
      first.id,
      4,
      cancelled.updatedAt.toISOString(),
    ),
  ).rejects.toMatchObject({ code: "GROUP_CANCELLED" });
  await createGroup(repo, admin, courseId, "08:00", 2);
  expect(
    await database.db
      .select()
      .from(groups)
      .where(eq(groups.courseId, courseId)),
  ).toHaveLength(4);
  expect(
    (
      await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, first.id))
    )
      .map((r) => r.action)
      .sort(),
  ).toEqual([
    "GROUP_CANCELLED",
    "GROUP_CAPACITY_CHANGED",
    "GROUP_CREATED",
    "SESSION_CALENDAR_GENERATED",
  ]);
});

test("concurrent creates serialize on course row; failed writes leave no audit", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      createGroup(repo, admin, courseId, "08:00", 15),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    results
      .filter((r) => r.status === "rejected")
      .every(
        (r) =>
          r.status === "rejected" &&
          (r.reason as { code: string }).code === "SCHEDULE_CONFLICT",
      ),
  ).toBe(true);
  expect(await repo.list(courseId)).toHaveLength(2);
});

test("withdrawal retains group snapshot and permits new groups with pinned revision", async () => {
  const group = await createGroup(repo, admin, courseId, "08:00", 2);
  await courseRepo.transition(courseId, "DRAFT", admin.id);
  const [course] = await database.db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId));
  expect(course?.courseTypeRevisionId).toBe(group.courseTypeRevisionId);
  const [revision] = await database.db
    .select()
    .from(courseTypeRevisions)
    .where(eq(courseTypeRevisions.id, group.courseTypeRevisionId));
  await formats.revise(
    revision!.courseTypeId,
    {
      totalHours: 30,
      sessionMinutes: 150,
      studentAmount: "120.00",
      externalAmount: "150.00",
    },
    admin.id,
  );
  const [stillPinned] = await database.db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId));
  expect(stillPinned?.courseTypeRevisionId).toBe(group.courseTypeRevisionId);
  const draftGroup = await createGroup(repo, admin, courseId, "09:30", 2);
  expect(draftGroup.courseTypeRevisionId).toBe(group.courseTypeRevisionId);
  const rescheduled = await changeGroupSchedule(
    repo,
    admin,
    draftGroup.id,
    "10:00",
    draftGroup.updatedAt.toISOString(),
  );
  expect(rescheduled.startsAt).not.toEqual(draftGroup.startsAt);
  expect(
    (await cancelGroup(repo, admin, group.id, group.updatedAt.toISOString()))
      .status,
  ).toBe("CANCELLED");
  const republished = await courseRepo.transition(
    courseId,
    "PUBLISHED",
    admin.id,
  );
  expect(republished.courseTypeRevisionId).toBe(group.courseTypeRevisionId);
});

test("publication is tracked per group, including publication after draft creation", async () => {
  const exposed = await createGroup(repo, admin, courseId, "08:00", 3);
  expect(exposed.publishedAt).toBeInstanceOf(Date);
  await courseRepo.transition(courseId, "DRAFT", admin.id);
  const draftOnly = await createGroup(repo, admin, courseId, "09:30", 3);
  expect(draftOnly.publishedAt).toBeNull();
  await expect(
    deleteGroup(repo, admin, exposed.id, exposed.updatedAt.toISOString()),
  ).rejects.toMatchObject({ code: "GROUP_PUBLISHED" });
  await deleteGroup(
    repo,
    admin,
    draftOnly.id,
    draftOnly.updatedAt.toISOString(),
  );
  expect((await repo.list(courseId)).map((group) => group.id)).toEqual([
    prerequisiteGroupId,
    exposed.id,
  ]);
  expect(
    (
      await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, draftOnly.id))
    )
      .map((event) => event.action)
      .sort(),
  ).toEqual(["GROUP_CREATED", "GROUP_DELETED", "SESSION_CALENDAR_GENERATED"]);
  await expect(
    database.db.delete(groups).where(eq(groups.id, exposed.id)).execute(),
  ).rejects.toThrow();
  const unexposed = await createGroup(repo, admin, courseId, "09:30", 4);
  await courseRepo.transition(courseId, "PUBLISHED", admin.id);
  const [nowExposed] = await database.db
    .select()
    .from(groups)
    .where(eq(groups.id, unexposed.id));
  expect(nowExposed?.publishedAt).toBeInstanceOf(Date);
  await courseRepo.transition(courseId, "DRAFT", admin.id);
  await expect(
    deleteGroup(repo, admin, unexposed.id, unexposed.updatedAt.toISOString()),
  ).rejects.toMatchObject({ code: "GROUP_PUBLISHED" });
});

test("cancelled draft groups stay deletable until active on publication", async () => {
  await courseRepo.transition(courseId, "DRAFT", admin.id);
  const group = await createGroup(repo, admin, courseId, "08:00", 2);
  const cancelled = await cancelGroup(
    repo,
    admin,
    group.id,
    group.updatedAt.toISOString(),
  );
  await courseRepo.transition(courseId, "PUBLISHED", admin.id);
  const [stillDraftOnly] = await database.db
    .select()
    .from(groups)
    .where(eq(groups.id, group.id));
  expect(stillDraftOnly?.publishedAt).toBeNull();
  await deleteGroup(repo, admin, group.id, cancelled.updatedAt.toISOString());
});

test("reactivating a previously unexposed group on a published course records exposure", async () => {
  await courseRepo.transition(courseId, "DRAFT", admin.id);
  const group = await createGroup(repo, admin, courseId, "08:00", 2);
  const cancelled = await cancelGroup(
    repo,
    admin,
    group.id,
    group.updatedAt.toISOString(),
  );
  await courseRepo.transition(courseId, "PUBLISHED", admin.id);
  const active = await reactivateGroup(
    repo,
    admin,
    group.id,
    cancelled.updatedAt.toISOString(),
  );
  expect(active.publishedAt).toBeInstanceOf(Date);
  await expect(
    deleteGroup(repo, admin, active.id, active.updatedAt.toISOString()),
  ).rejects.toMatchObject({ code: "GROUP_PUBLISHED" });
});

test("reactivation checks overlaps, state, revision, course availability and permissions", async () => {
  const group = await createGroup(repo, admin, courseId, "08:00", 2);
  const cancelled = await cancelGroup(
    repo,
    admin,
    group.id,
    group.updatedAt.toISOString(),
  );
  const replacement = await createGroup(repo, admin, courseId, "08:00", 3);
  await expect(
    reactivateGroup(repo, admin, group.id, cancelled.updatedAt.toISOString()),
  ).rejects.toMatchObject({ code: "SCHEDULE_CONFLICT" });
  await cancelGroup(
    repo,
    admin,
    replacement.id,
    replacement.updatedAt.toISOString(),
  );
  await expect(
    reactivateGroup(repo, admin, group.id, group.updatedAt.toISOString()),
  ).rejects.toMatchObject({ code: "STALE_GROUP" });
  const active = await reactivateGroup(
    repo,
    admin,
    group.id,
    cancelled.updatedAt.toISOString(),
  );
  expect(active.status).toBe("PLANNED");
  expect(active.publishedAt).toEqual(group.publishedAt);
  await expect(
    reactivateGroup(repo, admin, group.id, active.updatedAt.toISOString()),
  ).rejects.toMatchObject({ code: "GROUP_ACTIVE" });
  await expect(
    deleteGroup(
      repo,
      { ...admin, roles: ["INSTRUCTOR"] },
      group.id,
      active.updatedAt.toISOString(),
    ),
  ).rejects.toThrow();
  await expect(
    reactivateGroup(
      repo,
      { ...admin, status: "DISABLED" },
      group.id,
      active.updatedAt.toISOString(),
    ),
  ).rejects.toThrow();
  const [event] = await database.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, group.id))
    .orderBy(sql`created_at desc`)
    .limit(1);
  expect(event?.action).toBe("GROUP_REACTIVATED");
  await courseRepo.transition(courseId, "ARCHIVED", admin.id);
  const archivedCancelled = await cancelGroup(
    repo,
    admin,
    group.id,
    active.updatedAt.toISOString(),
  );
  await expect(
    reactivateGroup(
      repo,
      admin,
      group.id,
      archivedCancelled.updatedAt.toISOString(),
    ),
  ).rejects.toMatchObject({ code: "COURSE_UNAVAILABLE" });
});

test("parallel delete and cancellation serialize and stale attempts leave no extra audit", async () => {
  await courseRepo.transition(courseId, "DRAFT", admin.id);
  const group = await createGroup(repo, admin, courseId, "08:00", 2);
  const results = await Promise.allSettled([
    deleteGroup(repo, admin, group.id, group.updatedAt.toISOString()),
    cancelGroup(repo, admin, group.id, group.updatedAt.toISOString()),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    (
      await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, group.id))
    ).filter((event) => event.action !== "GROUP_CREATED"),
  ).toHaveLength(2); // Calendar generation plus exactly one successful lifecycle operation.
});

test("deletion rejects stale revisions and rolls back if audit cannot be written", async () => {
  await courseRepo.transition(courseId, "DRAFT", admin.id);
  const group = await createGroup(repo, admin, courseId, "08:00", 2);
  const updated = await changeGroupCapacity(
    repo,
    admin,
    group.id,
    3,
    group.updatedAt.toISOString(),
  );
  await expect(
    deleteGroup(repo, admin, group.id, group.updatedAt.toISOString()),
  ).rejects.toMatchObject({ code: "STALE_GROUP" });
  await expect(
    repo.delete(group.id, crypto.randomUUID(), updated.updatedAt),
  ).rejects.toThrow();
  expect((await repo.list(courseId)).map((entry) => entry.id)).toContain(
    group.id,
  );
  await deleteGroup(repo, admin, group.id, updated.updatedAt.toISOString());
  await expect(
    deleteGroup(repo, admin, group.id, updated.updatedAt.toISOString()),
  ).rejects.toMatchObject({ code: "GROUP_NOT_FOUND" });
});

test("date-only courses accept different group hours and preserve dates on unrelated edits", async () => {
  const existing = await courseRepo.getAdmin(courseId);
  if (!existing) throw new Error("Missing course");
  const dates = planCourseDates({
    startDate: "2027-03-01",
    weekdaysMask: 31,
    totalHours: 20,
    sessionMinutes: 90,
  });
  const updated = await courseRepo.create(
    {
      ...existing,
      name: `Date-only ${crypto.randomUUID()}`,
      schedule: GROUP_SCHEDULE,
      startsAt: dates.startsAt,
      endsAt: dates.endsAt,
    },
    admin.id,
  );
  courseId = updated.id;
  const morning = await createGroup(repo, admin, courseId, "08:00", 5);
  const afternoon = await createGroup(repo, admin, courseId, "14:00", 8);
  expect(morning.startsAt).toEqual(new Date("2027-03-01T12:00:00.000Z"));
  expect(afternoon.endsAt).toEqual(new Date("2027-03-17T19:30:00.000Z"));
  expect(
    await courseRepo.update(
      courseId,
      { ...updated, description: `${updated.description} editada` },
      admin.id,
      updated.updatedAt,
    ),
  ).toMatchObject({
    startsAt: dates.startsAt,
    endsAt: dates.endsAt,
  });
});

test("creates canonical date-only courses and rejects forged date bounds", async () => {
  const existing = await courseRepo.getAdmin(courseId);
  if (!existing) throw new Error("Missing course");
  const dates = planCourseDates({
    startDate: "2027-03-01",
    weekdaysMask: 31,
    totalHours: 20,
    sessionMinutes: 90,
  });
  const input = {
    ...existing,
    name: `Date-only ${crypto.randomUUID()}`,
    schedule: GROUP_SCHEDULE,
    startsAt: dates.startsAt,
    endsAt: dates.endsAt,
  };
  await expect(
    courseRepo.create(
      { ...input, endsAt: new Date("2027-03-18T03:58:00.000Z") },
      admin.id,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const created = await courseRepo.create(input, admin.id);
  expect(created.startsAt).toEqual(dates.startsAt);
  expect(created.endsAt).toEqual(dates.endsAt);
  expect(created.schedule).toBe(GROUP_SCHEDULE);
  const group = await createGroup(repo, admin, created.id, "11:00", 1);
  expect(group.endsAt).toEqual(new Date("2027-03-17T16:30:00.000Z"));
});

test("grouped courses retain their calendar and require an active format to republish", async () => {
  await createGroup(repo, admin, courseId, "08:00", 2);
  const existing = await courseRepo.getAdmin(courseId);
  if (!existing) throw new Error("Missing course");
  await expect(
    courseRepo.update(
      courseId,
      validateCourseData({
        ...COURSE_FIXTURES.publishedOpenRegistration,
        name: existing.name,
        courseTypeId: existing.courseTypeId,
        startsAt: "2027-03-02T18:00",
        endsAt: "2027-03-18T19:30",
        schedule: "Lunes a viernes, 18:00–19:30",
        registrationStartAt: "2027-01-01T08:00",
        registrationEndAt: "2027-02-28T12:00",
      }),
      admin.id,
      existing.updatedAt,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await courseRepo.transition(courseId, "DRAFT", admin.id);
  const [revision] = await database.db
    .select()
    .from(courseTypeRevisions)
    .where(eq(courseTypeRevisions.id, existing.courseTypeRevisionId));
  await formats.setActive(revision!.courseTypeId, false, admin.id);
  await expect(
    courseRepo.transition(courseId, "PUBLISHED", admin.id),
  ).rejects.toMatchObject({ code: "FORMAT_INACTIVE" });
});

test("different instructors may have the same daily start across courses", async () => {
  const first = await createGroup(repo, admin, courseId, "08:00", 2);
  const [source] = await database.db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId));
  const [copy] = await database.db
    .insert(courses)
    .values({
      ...source!,
      id: crypto.randomUUID(),
      slug: `other-${crypto.randomUUID()}`,
      featured: false,
      instructorId: (await createInstructorFixture(database.db)).id,
    })
    .returning();
  expect(
    (await createGroup(repo, admin, copy!.id, "08:00", 2)).startsAt,
  ).toEqual(first.startsAt);
});

test("database rejects a group revision that does not belong to its course", async () => {
  const otherFormat = await formats.create(
    `Other groups ${crypto.randomUUID()}`,
    {
      totalHours: 20,
      sessionMinutes: 90,
      studentAmount: "80.00",
      externalAmount: "100.00",
    },
    admin.id,
  );
  const [otherRevision] = await database.db
    .select()
    .from(courseTypeRevisions)
    .where(eq(courseTypeRevisions.courseTypeId, otherFormat.id));
  if (!otherRevision) throw new Error("Missing other course revision");

  await expect(
    (async () => {
      await database.db.execute(sql`
      insert into public.groups
        (course_id, course_type_revision_id, capacity, starts_at, ends_at)
      values
        (${courseId}, ${otherRevision.id}, 1, '2027-03-01T11:00:00Z', '2027-03-17T12:30:00Z')
      `);
    })(),
  ).rejects.toThrow();
});

test("capacity accepts PostgreSQL's maximum integer and rejects the next value", async () => {
  const group = await createGroup(
    repo,
    admin,
    courseId,
    "08:00",
    2_147_483_647,
  );
  expect(group.capacity).toBe(2_147_483_647);
  await expect(
    createGroup(repo, admin, courseId, "09:30", 2_147_483_648),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

test("competing schedule edits serialize, rejecting stale revision and conflicts", async () => {
  const first = await createGroup(repo, admin, courseId, "08:00", 2);
  const second = await createGroup(repo, admin, courseId, "11:00", 2);
  const results = await Promise.allSettled([
    changeGroupSchedule(
      repo,
      admin,
      first.id,
      "09:30",
      first.updatedAt.toISOString(),
    ),
    changeGroupSchedule(
      repo,
      admin,
      second.id,
      "09:30",
      second.updatedAt.toISOString(),
    ),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  expect(await repo.list(courseId)).toHaveLength(3);
});

test("unstructured historical courses cannot be newly published without a planned group or host new groups", async () => {
  const existing = (await courseRepo.getAdmin(courseId))!;
  const course = await courseRepo.create(
    {
      ...existing,
      name: `Historical ${crypto.randomUUID()}`,
      weekdaysMask: null,
    },
    admin.id,
  );
  await expect(
    courseRepo.transition(course.id, "PUBLISHED", admin.id),
  ).rejects.toThrow("al menos un grupo");
  expect((await courseRepo.getAdmin(course.id))?.status).toBe("DRAFT");
  await expect(
    createGroup(repo, admin, course.id, "08:00", 1),
  ).rejects.toMatchObject({ code: "COURSE_UNAVAILABLE" });
});

test("rejects invalid capacity/time, unstructured historical courses, nonadmin and schedule changes to grouped course", async () => {
  await expect(
    createGroup(repo, admin, courseId, "24:00", 1),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(
    createGroup(repo, admin, courseId, "23:00", 1),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(
    createGroup(repo, admin, courseId, "08:00", 0),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(
    listGroups(repo, { ...admin, roles: ["INSTRUCTOR"] }, courseId),
  ).rejects.toThrow();
  await expect(
    createGroup(repo, { ...admin, status: "DISABLED" }, courseId, "08:00", 1),
  ).rejects.toThrow();
  const group = await createGroup(repo, admin, courseId, "08:00", 1);
  await expect(
    database.db
      .update(groups)
      .set({ capacity: 0 })
      .where(eq(groups.id, group.id))
      .execute(),
  ).rejects.toThrow();
  await expect(
    database.db
      .update(courses)
      .set({ startsAt: new Date("2027-03-02T22:00:00Z") })
      .where(eq(courses.id, courseId))
      .execute(),
  ).rejects.toThrow();
  const [row] = await database.db
    .select()
    .from(groups)
    .where(eq(groups.id, group.id));
  expect(row?.startsAt).toEqual(group.startsAt);
  const [rev] = await database.db
    .select()
    .from(courseTypeRevisions)
    .where(eq(courseTypeRevisions.id, group.courseTypeRevisionId));
  expect(rev?.sessionMinutes).toBe(90);
  const [security] = await database.db.execute<{
    rls: boolean;
    anon: boolean;
    authenticated: boolean;
    service: boolean;
  }>(
    sql`select c.relrowsecurity as rls, has_table_privilege('anon', 'public.groups', 'SELECT') as anon, has_table_privilege('authenticated', 'public.groups', 'SELECT') as authenticated, has_table_privilege('service_role', 'public.groups', 'SELECT') as service from pg_class c where c.oid = 'public.groups'::regclass`,
  );
  expect(security).toMatchObject({
    rls: true,
    anon: false,
    authenticated: false,
    service: false,
  });
  await expect(
    database.db.transaction(async (tx) => {
      await tx.execute(sql`set local role anon`);
      await tx.select().from(groups);
    }),
  ).rejects.toThrow();
});
