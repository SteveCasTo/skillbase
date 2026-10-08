import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { DrizzleGroupRepository } from "@/server/db/repositories/group-repository";
import {
  GROUP_SCHEDULE,
  planCourseDates,
} from "@/domain/courses/weekday-schedule";
import { civilDay } from "@/domain/attendance/rules";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { createAttendanceFlowFixture } from "../fixtures/attendance-flow";

const connection = createDatabase(getTestSupabaseEnvironment().databaseUrl);
const db = connection.db;

afterAll(() => connection.close());

const boliviaToday = civilDay(new Date());
const weekday = new Date(`${boliviaToday}T00:00:00Z`).getUTCDay();
const attendanceTest = weekday === 0 || weekday === 6 ? test.skip : test;

attendanceTest(
  "failed attendance setup releases only its own schedule reservations",
  async () => {
    const [admin] = await db
      .insert(schema.users)
      .values({
        email: AUTH_FIXTURES.admin.email,
        name: AUTH_FIXTURES.admin.name,
        status: "ACTIVE",
        authUserId: crypto.randomUUID(),
        authPrimaryProvider: "EMAIL",
      })
      .returning();
    await db.insert(schema.userRoles).values({
      userId: admin!.id,
      roleCode: "ADMIN",
    });
    const [teacher] = await db
      .insert(schema.users)
      .values({
        email: AUTH_FIXTURES.instructor.email,
        name: AUTH_FIXTURES.instructor.name,
        status: "ACTIVE",
        authUserId: crypto.randomUUID(),
        authPrimaryProvider: "EMAIL",
      })
      .returning();
    await db.insert(schema.userRoles).values({
      userId: teacher!.id,
      roleCode: "INSTRUCTOR",
    });
    await db.insert(schema.instructorProfiles).values({
      id: teacher!.id,
      firstName: "Fixture",
      lastName: "Instructor",
    });

    const [type] = await db
      .insert(schema.courseTypes)
      .values({ name: `Unowned attendance reservation ${crypto.randomUUID()}` })
      .returning();
    const [revision] = await db
      .insert(schema.courseTypeRevisions)
      .values({
        courseTypeId: type!.id,
        revisionNumber: 1,
        totalHours: 3,
        sessionMinutes: 90,
        studentAmount: "80",
        externalAmount: "100",
      })
      .returning();
    const today = civilDay(new Date());
    const dates = planCourseDates({
      startDate: today,
      weekdaysMask: 31,
      totalHours: 3,
      sessionMinutes: 90,
    });
    const [unownedCourse] = await db
      .insert(schema.courses)
      .values({
        name: `Unowned attendance reservation ${crypto.randomUUID()}`,
        slug: `unowned-attendance-${crypto.randomUUID()}`,
        description: "Independent reservation for fixture cleanup test",
        level: "BASIC",
        courseTypeRevisionId: revision!.id,
        instructorId: teacher!.id,
        schedule: GROUP_SCHEDULE,
        weekdaysMask: 31,
        conditions: "Synthetic",
        startsAt: dates.startsAt,
        endsAt: dates.endsAt,
        minimumGrade: 70,
        status: "PUBLISHED",
      })
      .returning();
    const unownedGroup = await new DrizzleGroupRepository(db).create(
      unownedCourse!.id,
      "20:00",
      5,
      admin!.id,
    );

    const failure = "controlled attendance fixture setup failure";
    const failedIds: { courseId: string; groupId: string }[] = [];
    let failedConnectionClosed = 0;
    await expect(
      createAttendanceFlowFixture("2020-05-04", false, {
        afterGroupCreated(count, courseId, groupId) {
          failedIds.push({ courseId, groupId });
          if (count === 2) throw new Error(failure);
        },
        afterDatabaseClosed() {
          failedConnectionClosed += 1;
        },
      }),
    ).rejects.toThrow(failure);
    expect(failedIds).toHaveLength(2);
    expect(failedConnectionClosed).toBe(1);

    const archivedCourses = await db
      .select({ id: schema.courses.id, status: schema.courses.status })
      .from(schema.courses)
      .where(eq(schema.courses.id, failedIds[0]!.courseId));
    const partiallyCreatedCourse = await db
      .select({ id: schema.courses.id, status: schema.courses.status })
      .from(schema.courses)
      .where(eq(schema.courses.id, failedIds[1]!.courseId));
    expect(archivedCourses[0]?.status).toBe("ARCHIVED");
    expect(partiallyCreatedCourse[0]?.status).toBe("ARCHIVED");
    for (const owned of failedIds) {
      const [group] = await db
        .select({ status: schema.groups.status })
        .from(schema.groups)
        .where(eq(schema.groups.id, owned.groupId));
      expect(group?.status).toBe("CANCELLED");
    }

    const recreated: { courseId: string; groupId: string }[] = [];
    let retryConnectionClosed = 0;
    const retry = await createAttendanceFlowFixture("2020-05-04", false, {
      afterGroupCreated(_count, courseId, groupId) {
        recreated.push({ courseId, groupId });
      },
      afterDatabaseClosed() {
        retryConnectionClosed += 1;
      },
    });
    await retry.close();
    await retry.close();
    expect(retryConnectionClosed).toBe(1);
    expect(recreated.length).toBeGreaterThan(0);

    const [preservedCourse] = await db
      .select({ status: schema.courses.status })
      .from(schema.courses)
      .where(eq(schema.courses.id, unownedCourse!.id));
    const [preservedGroup] = await db
      .select({ status: schema.groups.status })
      .from(schema.groups)
      .where(eq(schema.groups.id, unownedGroup.id));
    expect(preservedCourse?.status).toBe("PUBLISHED");
    expect(preservedGroup?.status).toBe("PLANNED");
  },
  30_000,
);
