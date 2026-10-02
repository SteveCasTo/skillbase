import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createDatabase, withRequestDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { createInstructorFixture } from "../fixtures/instructors";
import { DrizzleCourseRepository } from "@/server/db/repositories/course-repository";
import { DrizzleGroupRepository } from "@/server/db/repositories/group-repository";
import { DrizzleFormatRepository } from "@/server/db/repositories/format-repository";
import { DrizzleInstructorRepository } from "@/server/db/repositories/instructor-repository";
import { DrizzleAssignedCourseRepository } from "@/server/db/repositories/assigned-course-repository";
import { createInstructorAccount } from "@/server/auth/provision-instructor";
import { provisionPasswordInstructor } from "@/application/auth/provision-password-user";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { validateCourseData } from "@/domain/courses/validation";
import {
  GROUP_SCHEDULE,
  planCourseDates,
} from "@/domain/courses/weekday-schedule";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import type { InternalUser } from "@/domain/auth/types";

const environment = getTestSupabaseEnvironment();
const database = createDatabase(environment.databaseUrl, { max: 8 });
const courses = new DrizzleCourseRepository(database.db);
const groups = new DrizzleGroupRepository(database.db);
const profiles = new DrizzleInstructorRepository(database.db);
let admin: InternalUser;
let teacher: InternalUser;
let other: InternalUser;
let formatId: string;
beforeAll(async () => {
  teacher = await createInstructorFixture(database.db);
  other = await createInstructorFixture(database.db);
  const [actor] = await database.db
    .insert(schema.users)
    .values({
      email: `phase4-admin-${crypto.randomUUID()}@test.invalid`,
      name: "Phase4 Admin",
      status: "ACTIVE",
      authUserId: crypto.randomUUID(),
    })
    .returning();
  if (!actor) throw new Error("Admin missing");
  admin = { ...actor, roles: ["ADMIN"] };
  await database.db
    .insert(schema.userRoles)
    .values({ userId: actor.id, roleCode: "ADMIN" });
  formatId = (
    await new DrizzleFormatRepository(database.db).create(
      `Phase4 ${crypto.randomUUID()}`,
      {
        totalHours: 3,
        sessionMinutes: 90,
        studentAmount: "10.00",
        externalAmount: "20.00",
      },
      actor.id,
    )
  ).id;
});
afterAll(async () => {
  await database.close();
});
test("profile and assignment history have RLS and no browser-role privileges", async () => {
  const rows = await database.db.execute<{
    relname: string;
    relrowsecurity: boolean;
    readable: boolean;
    writable: boolean;
  }>(
    sql`select relname, relrowsecurity, has_table_privilege('anon', oid, 'SELECT') or has_table_privilege('authenticated', oid, 'SELECT') as readable, has_table_privilege('anon', oid, 'INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', oid, 'INSERT,UPDATE,DELETE') as writable from pg_class where relnamespace = 'public'::regnamespace and relname in ('instructor_profiles', 'course_instructor_history') order by relname`,
  );
  expect(rows).toHaveLength(2);
  expect(
    rows.every((row) => row.relrowsecurity && !row.readable && !row.writable),
  ).toBe(true);
});
let serial = 0;
async function course(
  instructorId: string | null = null,
  startDate = "2027-06-01",
) {
  const plan = planCourseDates({
    startDate,
    weekdaysMask: 31,
    totalHours: 3,
    sessionMinutes: 90,
  });
  return courses.create(
    validateCourseData({
      name: `Instructor course ${crypto.randomUUID()} ${serial++}`,
      description: "Synthetic course",
      level: "BASIC",
      courseTypeId: formatId,
      instructorId: instructorId ?? "",
      schedule: GROUP_SCHEDULE,
      weekdays: "1,2,3,4,5",
      conditions: "Synthetic",
      startsAt: `${startDate}T00:00`,
      endsAt: instantToBoliviaCivil(plan.endsAt),
      minimumGrade: "70",
    }),
    admin.id,
  );
}
test("publication requires registered active instructor and public projection contains only assigned full name", async () => {
  const draft = await course(null, "2027-07-01");
  await expect(
    courses.transition(draft.id, "PUBLISHED", admin.id),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const assigned = await courses.update(
    draft.id,
    { ...draft, instructorId: teacher.id },
    admin.id,
    draft.updatedAt,
  );
  await courses.transition(assigned.id, "PUBLISHED", admin.id);
  const publicCourse = await courses.getPublic(assigned.slug);
  expect(publicCourse?.instructorName).toBe("Fixture Instructor");
  expect(JSON.stringify(publicCourse)).not.toContain(teacher.email);
  expect(publicCourse).not.toHaveProperty("instructorId");
});
test("concurrent conflicting assignments across courses exactly one commits", async () => {
  const a = await course();
  const b = await course();
  await groups.create(a.id, "08:00", 10, admin.id);
  await groups.create(b.id, "09:00", 10, admin.id);
  const results = await Promise.allSettled([
    courses.update(
      a.id,
      { ...a, instructorId: teacher.id },
      admin.id,
      a.updatedAt,
    ),
    courses.update(
      b.id,
      { ...b, instructorId: teacher.id },
      admin.id,
      b.updatedAt,
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
test("concurrent conflicting group writes across courses exactly one commits; adjacency succeeds", async () => {
  const a = await course(other.id, "2027-08-02");
  const b = await course(other.id, "2027-08-02");
  const results = await Promise.allSettled([
    groups.create(a.id, "08:00", 10, admin.id),
    groups.create(b.id, "09:00", 10, admin.id),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const winner = results[0]!.status === "fulfilled" ? a : b;
  const loser = winner.id === a.id ? b : a;
  const first = (await groups.list(winner.id))[0]!;
  const hour = first.startsAt.getUTCHours() === 12 ? "09:30" : "10:30";
  expect((await groups.create(loser.id, hour, 10, admin.id)).courseId).toBe(
    loser.id,
  );
});
test("assignment and group creation share the same cross-course serialization", async () => {
  const a = await course(teacher.id, "2027-10-04");
  const b = await course(null, "2027-10-04");
  await groups.create(b.id, "09:00", 10, admin.id);
  const results = await Promise.allSettled([
    groups.create(a.id, "08:00", 10, admin.id),
    courses.update(
      b.id,
      { ...b, instructorId: teacher.id },
      admin.id,
      b.updatedAt,
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
test("editorial archive does not silently cancel planned groups; explicit cancellation frees their interval", async () => {
  const a = await course(teacher.id, "2028-02-01");
  const b = await course(teacher.id, "2028-02-01");
  const group = await groups.create(a.id, "08:00", 10, admin.id);
  await courses.transition(a.id, "ARCHIVED", admin.id);
  await expect(
    groups.create(b.id, "08:00", 10, admin.id),
  ).rejects.toMatchObject({ code: "SCHEDULE_CONFLICT" });
  await groups.cancel(group.id, admin.id, group.updatedAt);
  expect((await groups.create(b.id, "08:00", 10, admin.id)).courseId).toBe(
    b.id,
  );
});
test("competing cross-course schedule edits and reactivations cannot both occupy the same interval", async () => {
  const a = await course(teacher.id, "2027-11-01");
  const b = await course(teacher.id, "2027-11-01");
  const first = await groups.create(a.id, "07:00", 10, admin.id);
  const second = await groups.create(b.id, "11:00", 10, admin.id);
  const edits = await Promise.allSettled([
    groups.changeSchedule(first.id, "09:00", admin.id, first.updatedAt),
    groups.changeSchedule(second.id, "09:00", admin.id, second.updatedAt),
  ]);
  expect(edits.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(edits.filter((r) => r.status === "rejected")).toHaveLength(1);
  const c = await course(teacher.id, "2027-12-01");
  const d = await course(teacher.id, "2027-12-01");
  const cg = await groups.create(c.id, "08:00", 10, admin.id);
  const cancelledC = await groups.cancel(cg.id, admin.id, cg.updatedAt);
  const dg = await groups.create(d.id, "08:00", 10, admin.id);
  const cancelledD = await groups.cancel(dg.id, admin.id, dg.updatedAt);
  const reactivations = await Promise.allSettled([
    groups.reactivate(cg.id, admin.id, cancelledC.updatedAt),
    groups.reactivate(dg.id, admin.id, cancelledD.updatedAt),
  ]);
  expect(reactivations.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(reactivations.filter((r) => r.status === "rejected")).toHaveLength(1);
});
test("ownership is applied to every course and group query and instructor has no mutation repository", async () => {
  const owned = await course(teacher.id, "2027-09-01");
  const foreign = await course(other.id, "2027-09-01");
  await groups.create(foreign.id, "13:00", 10, admin.id);
  const repository = new DrizzleAssignedCourseRepository(database.db);
  expect(
    (await repository.list(teacher.id)).some((row) => row.id === owned.id),
  ).toBe(true);
  expect(
    (await repository.list(teacher.id)).some((row) => row.id === foreign.id),
  ).toBe(false);
  expect(await repository.get(teacher.id, foreign.id)).toBeNull();
  expect(await repository.groups(teacher.id, foreign.id)).toEqual([]);
});
test("started courses reject reassignment/date changes, but same-instructor content edits succeed", async () => {
  const started = await course(teacher.id, "2025-09-01");
  await expect(
    courses.update(
      started.id,
      { ...started, instructorId: other.id },
      admin.id,
      started.updatedAt,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(
    courses.update(
      started.id,
      { ...started, startsAt: new Date("2028-01-01T04:00Z") },
      admin.id,
      started.updatedAt,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(
    (
      await courses.update(
        started.id,
        { ...started, description: "Updated content" },
        admin.id,
        started.updatedAt,
      )
    ).instructorId,
  ).toBe(teacher.id);
});
test("registered assignment rejects disabled and nonexistent users; reassignment retains historical stable FK", async () => {
  const legacy = await course(null, "2028-01-03");
  await expect(
    courses.update(
      legacy.id,
      { ...legacy, instructorId: crypto.randomUUID() },
      admin.id,
      legacy.updatedAt,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const inactive = await createInstructorFixture(database.db);
  await database.db
    .update(schema.users)
    .set({ status: "DISABLED" })
    .where(eq(schema.users.id, inactive.id));
  await expect(
    courses.update(
      legacy.id,
      { ...legacy, instructorId: inactive.id },
      admin.id,
      legacy.updatedAt,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const historical = await createInstructorFixture(database.db);
  const initial = await courses.update(
    legacy.id,
    { ...legacy, instructorId: historical.id },
    admin.id,
    legacy.updatedAt,
  );
  await courses.update(
    initial.id,
    { ...initial, instructorId: other.id },
    admin.id,
    initial.updatedAt,
  );
  const history = await database.db
    .select()
    .from(schema.courseInstructorHistory)
    .where(eq(schema.courseInstructorHistory.courseId, legacy.id));
  expect(history.map((row) => row.instructorId).sort()).toEqual(
    [historical.id, other.id].sort(),
  );
  await expect(
    database.db
      .delete(schema.instructorProfiles)
      .where(eq(schema.instructorProfiles.id, historical.id))
      .execute(),
  ).rejects.toThrow();
});
test("profile revisions protect lost updates and stable references; audit excludes contact", async () => {
  const profile = (await profiles.get(teacher.id))!;
  await profiles.update(
    teacher.id,
    { firstName: "Updated", lastName: "Instructor", phone: "+591 70000000" },
    admin.id,
    profile.updatedAt,
  );
  await expect(
    profiles.update(
      teacher.id,
      { firstName: "Stale", lastName: "Instructor", phone: null },
      admin.id,
      profile.updatedAt,
    ),
  ).rejects.toThrow("cambió");
  const audits = await database.db
    .select()
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.entityId, teacher.id),
        eq(schema.auditEvents.entityType, "INSTRUCTOR"),
      ),
    );
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits)).not.toContain("70000000");
  await expect(
    database.db
      .delete(schema.instructorProfiles)
      .where(eq(schema.instructorProfiles.id, teacher.id))
      .execute(),
  ).rejects.toThrow();
});
test("Auth provisioning composes account, role, profile and audit atomically; invalid profile creates no provider identity", async () => {
  const provider = createClient(
    environment.apiUrl,
    environment.serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const password = randomBytes(24).toString("base64url");
  const actor = await provider.auth.admin.createUser({
    email: `phase4-provider-${crypto.randomUUID()}@test.invalid`,
    password,
    email_confirm: true,
  });
  if (!actor.data.user) throw new Error("Auth actor missing");
  await database.db
    .update(schema.users)
    .set({ authUserId: actor.data.user.id })
    .where(eq(schema.users.id, admin.id));
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = environment.serviceRoleKey;
  let created: InternalUser | null = null;
  try {
    created = await withRequestDatabase(
      () =>
        createInstructorAccount(actor.data.user!.id, {
          email: `phase4-created-${crypto.randomUUID()}@test.invalid`,
          name: "Ignored",
          password,
          profile: { firstName: "Atomic", lastName: "Instructor", phone: null },
        }),
      undefined,
      environment.databaseUrl,
    );
    expect(created.id).not.toBe(created.authUserId);
    expect((await profiles.get(created.id))?.firstName).toBe("Atomic");
    expect(created.roles).toEqual(["INSTRUCTOR"]);
    expect(JSON.stringify(created)).not.toContain(password);
    await expect(
      withRequestDatabase(
        () =>
          createInstructorAccount(actor.data.user!.id, {
            email: `invalid-${crypto.randomUUID()}@test.invalid`,
            name: "Invalid",
            password,
            profile: { firstName: "", lastName: "Instructor", phone: null },
          }),
        undefined,
        environment.databaseUrl,
      ),
    ).rejects.toThrow();
  } finally {
    if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
    if (created) await provider.auth.admin.deleteUser(created.authUserId!);
    await provider.auth.admin.deleteUser(actor.data.user.id);
  }
});
test("failed professional-profile persistence rolls back account/role and compensates only the new Auth identity", async () => {
  const provider = createClient(
    environment.apiUrl,
    environment.serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const [actor] = await database.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, admin.id));
  if (!actor?.authUserId) throw new Error("Actor missing");
  class FailingProfileRepository extends DrizzleAuthUserRepository {
    override createPasswordInstructor(
      input: Parameters<
        DrizzleAuthUserRepository["createPasswordInstructor"]
      >[0],
    ) {
      return super.createPasswordInstructor({
        ...input,
        profile: {
          firstName: "x".repeat(101),
          lastName: "Instructor",
          phone: null,
        },
      });
    }
  }
  const email = `phase4-rollback-${crypto.randomUUID()}@test.invalid`;
  let newAuthId = "";
  const removed: string[] = [];
  await expect(
    provisionPasswordInstructor(
      new FailingProfileRepository(database.db),
      {
        async createConfirmedUser(value, password) {
          const result = await provider.auth.admin.createUser({
            email: value,
            password,
            email_confirm: true,
          });
          newAuthId = result.data.user?.id ?? "";
          return newAuthId || null;
        },
        async removeCreatedUser(id) {
          removed.push(id);
          await provider.auth.admin.deleteUser(id);
        },
      },
      actor.authUserId,
      {
        email,
        name: "Rollback Instructor",
        password: randomBytes(24).toString("base64url"),
        profile: { firstName: "Rollback", lastName: "Instructor", phone: null },
      },
    ),
  ).rejects.toThrow("No pudimos crear");
  expect(newAuthId).not.toBe("");
  expect(removed).toEqual([newAuthId]);
  expect(
    (await provider.auth.admin.getUserById(newAuthId)).data.user,
  ).toBeNull();
  expect(
    await database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email)),
  ).toHaveLength(0);
  expect((await profiles.get(teacher.id))?.id).toBe(teacher.id);
});
