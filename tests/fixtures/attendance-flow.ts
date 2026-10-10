import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { DrizzleGroupRepository } from "@/server/db/repositories/group-repository";
import { DrizzleAttendanceRepository } from "@/server/db/repositories/attendance-repository";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";
import {
  planCourseDates,
  GROUP_SCHEDULE,
} from "@/domain/courses/weekday-schedule";
import { civilDay } from "@/domain/attendance/rules";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { e2eSiteUrl } from "../../scripts/e2e-port";
import { AUTH_FIXTURES } from "./auth-users";
import { createInstructorFixture } from "./instructors";

type AttendanceFixtureTestHooks = {
  afterGroupCreated?: (
    ownedGroupCount: number,
    courseId: string,
    groupId: string,
  ) => void | Promise<void>;
  afterDatabaseClosed?: () => void;
};

function attendanceFixtureNow() {
  const current = new Date();
  if (process.env.E2E_TEST_CLOCK_CONTROL !== "1") return current;
  const day = new Date(`${civilDay(current)}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6
    ? new Date(current.getTime() - (day === 6 ? 1 : 2) * 86_400_000)
    : current;
}

async function setAttendanceFixtureClock(now: Date | null) {
  if (process.env.E2E_TEST_CLOCK_CONTROL !== "1") return;
  const url = now
    ? `${e2eSiteUrl()}/__e2e/clock?now=${encodeURIComponent(now.toISOString())}`
    : `${e2eSiteUrl()}/__e2e/clock/reset`;
  const response = await fetch(url, { method: "POST" });
  if (response.status !== 204)
    throw new Error("Unable to control the isolated E2E application clock");
}

/** Trusted setup only, on the runner's verified ephemeral DB and scoped E2E clock. */
export async function createAttendanceFlowFixture(
  startDate: string,
  withForeign = false,
  testHooks: AttendanceFixtureTestHooks = {},
) {
  const now = attendanceFixtureNow();
  const database = createDatabase(getTestSupabaseEnvironment().databaseUrl);
  const db = database.db;
  const [admin] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, AUTH_FIXTURES.admin.email));
  const [teacher] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, AUTH_FIXTURES.instructor.email));
  if (!admin || !teacher) {
    await database.close();
    throw new Error("Isolated attendance actors missing");
  }
  const courseIds: string[] = [];
  const groupsToCancel: { id: string; updatedAt: Date }[] = [];
  const groups = new DrizzleGroupRepository(db);
  let closed = false;
  let databaseClosed = false;
  let clockReset = false;
  async function cleanup() {
    // Archive first so a partially-created course is not exposed as an offer;
    // cancel every tracked group through the repository to release reservations.
    const failures: unknown[] = [];
    for (const id of courseIds) {
      try {
        await db
          .update(schema.courses)
          .set({ status: "ARCHIVED" })
          .where(eq(schema.courses.id, id));
      } catch (error) {
        failures.push(error);
      }
    }
    for (const group of groupsToCancel) {
      try {
        await groups.cancel(group.id, admin!.id, group.updatedAt);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "Attendance fixture cleanup failed");
  }
  async function close() {
    if (closed) return;
    const failures: unknown[] = [];
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
    if (!databaseClosed) {
      try {
        await database.close();
        databaseClosed = true;
        testHooks.afterDatabaseClosed?.();
      } catch (error) {
        failures.push(error);
      }
    }
    if (!clockReset) {
      try {
        await setAttendanceFixtureClock(null);
        clockReset = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "Attendance fixture close failed");
    closed = true;
  }
  try {
    await setAttendanceFixtureClock(now);
    const clock = new Date("2020-01-01T12:00:00.000Z");
    const [format] = await db
      .insert(schema.courseTypes)
      .values({ name: `Attendance E2E ${crypto.randomUUID()}` })
      .returning();
    const [revision] = await db
      .insert(schema.courseTypeRevisions)
      .values({
        courseTypeId: format!.id,
        revisionNumber: 1,
        totalHours: 3,
        sessionMinutes: 90,
        studentAmount: "80",
        externalAmount: "100",
      })
      .returning();
    async function course(
      instructorId: string,
      date: string,
      createdAt = clock,
      startTime = "08:00",
    ) {
      const dates = planCourseDates({
        startDate: date,
        weekdaysMask: 31,
        totalHours: 3,
        sessionMinutes: 90,
      });
      const [created] = await db
        .insert(schema.courses)
        .values({
          name: `Attendance E2E ${crypto.randomUUID()}`,
          slug: `attendance-e2e-${crypto.randomUUID()}`,
          description: "Isolated attendance flow",
          level: "BASIC",
          courseTypeRevisionId: revision!.id,
          instructorId,
          schedule: GROUP_SCHEDULE,
          weekdaysMask: 31,
          conditions: "Synthetic",
          startsAt: dates.startsAt,
          endsAt: dates.endsAt,
          minimumGrade: 70,
          status: "PUBLISHED",
          createdAt,
          updatedAt: createdAt,
        })
        .returning();
      courseIds.push(created!.id);
      const group = await new DrizzleGroupRepository(
        db,
        () => createdAt,
      ).create(created!.id, startTime, 5, admin!.id);
      groupsToCancel.push({ id: group.id, updatedAt: group.updatedAt });
      await testHooks.afterGroupCreated?.(
        groupsToCancel.length,
        created!.id,
        group.id,
      );
      return { course: created!, group };
    }
    const history = await course(teacher.id, startDate);
    const today = civilDay(now);
    const own = await course(
      teacher.id,
      today,
      now,
      withForeign ? "18:00" : "08:00",
    );
    const finance = createRegistrationRepository(db, () => now);
    const settings = await finance.settings(admin.id);
    async function enroll(full: boolean, historical = !full) {
      const target = historical ? history : own;
      return createRegistrationRepository(db, () =>
        historical ? clock : now,
      ).create(
        {
          requestKey: crypto.randomUUID(),
          courseId: target.course.id,
          groupId: target.group.id,
          courseRevision: target.course.updatedAt.toISOString(),
          settingsRevision: settings.revision,
          sourceInterestId: null,
          firstDayException: !historical,
          participantType: "STUDENT",
          participant: {
            ci: `ATT-${crypto.randomUUID()}`,
            firstName: full ? "Enrolled" : "Awaiting",
            lastName: "Attendance",
            email: `attendance-${crypto.randomUUID()}@test.invalid`,
            phone: null,
          },
          initialPayment: {
            amountCents: full ? 8000 : 2000,
            effectiveDate: null,
            reason: "Trusted isolated attendance fixture",
          },
        },
        admin!.id,
      );
    }
    const paid = await enroll(true, false),
      partial = await enroll(false),
      historyPaid = await enroll(true, true);
    const attendance = new DrizzleAttendanceRepository(db);
    const calendar = await attendance.getGroup(
      admin.id,
      own.course.id,
      own.group.id,
    );
    const current = calendar.sessions[0]!;
    const historyCalendar = await attendance.getGroup(
      admin.id,
      history.course.id,
      history.group.id,
    );
    const adjustableStart = new Date(`${today}T00:00:00Z`);
    do {
      adjustableStart.setUTCDate(adjustableStart.getUTCDate() + 1);
    } while (
      adjustableStart.getUTCDay() === 0 ||
      adjustableStart.getUTCDay() === 6
    );
    const adjustableDate = adjustableStart.toISOString().slice(0, 10);
    const adjustable = await course(
      teacher.id,
      adjustableDate,
      now,
      withForeign ? "20:00" : "12:00",
    );
    const adjustableCalendar = await attendance.getGroup(
      admin.id,
      adjustable.course.id,
      adjustable.group.id,
    );
    let foreign:
      { courseId: string; groupId: string; sessionId: string } | undefined;
    if (withForeign) {
      const other = await createInstructorFixture(db);
      const created = await course(other.id, "2020-07-06");
      const otherCalendar = await attendance.getGroup(
        admin.id,
        created.course.id,
        created.group.id,
      );
      foreign = {
        courseId: created.course.id,
        groupId: created.group.id,
        sessionId: otherCalendar.sessions[0]!.id,
      };
    }
    return {
      database,
      now,
      attendance,
      adminId: admin.id,
      instructorId: teacher.id,
      courseId: own.course.id,
      groupId: own.group.id,
      session: current,
      historyCourseId: history.course.id,
      historyGroupId: history.group.id,
      adjustable: {
        courseId: adjustable.course.id,
        groupId: adjustable.group.id,
        session: adjustableCalendar.sessions[0]!,
      },
      replacementTime: withForeign ? "22:00" : "15:00",
      pastSession: historyCalendar.sessions[0]!,
      paid,
      partial,
      historyPaid,
      foreign,
      close,
    };
  } catch (setupError) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [setupError, cleanupError],
        "Attendance fixture setup and cleanup both failed",
      );
    }
    throw setupError;
  }
}
