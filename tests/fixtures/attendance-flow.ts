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
import { AUTH_FIXTURES } from "./auth-users";
import { createInstructorFixture } from "./instructors";

/** Trusted setup only, on the runner's verified ephemeral DB. HTTP uses real time. */
export async function createAttendanceFlowFixture(
  startDate: string,
  todayTime: string,
  withForeign = false,
) {
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
  const clock = new Date("2019-12-01T12:00:00.000Z");
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
  const courseIds: string[] = [];
  async function course(instructorId: string, date: string) {
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
        createdAt: clock,
        updatedAt: clock,
      })
      .returning();
    courseIds.push(created!.id);
    const group = await new DrizzleGroupRepository(db, () => clock).create(
      created!.id,
      "08:00",
      5,
      admin!.id,
    );
    return { course: created!, group };
  }
  const own = await course(teacher.id, startDate);
  const finance = createRegistrationRepository(db, () => clock);
  const settings = await finance.settings(admin.id);
  async function enroll(full: boolean) {
    return finance.create(
      {
        requestKey: crypto.randomUUID(),
        courseId: own.course.id,
        groupId: own.group.id,
        courseRevision: own.course.updatedAt.toISOString(),
        settingsRevision: settings.revision,
        sourceInterestId: null,
        firstDayException: false,
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
  const paid = await enroll(true),
    partial = await enroll(false);
  const attendance = new DrizzleAttendanceRepository(db);
  const calendar = await attendance.getGroup(
    admin.id,
    own.course.id,
    own.group.id,
  );
  const original = calendar.sessions[0]!;
  const today = civilDay(new Date());
  const recovery = await attendance.replace(admin.id, {
    requestKey: crypto.randomUUID(),
    courseId: own.course.id,
    groupId: own.group.id,
    sessionId: original.id,
    revision: original.revision,
    startsAt: `${today}T${todayTime}`,
    reason: "Trusted fixture scheduled for today's attendance",
  });
  if (recovery.kind !== "session")
    throw new Error("Session fixture not created");
  const current = await attendance.getSession(
    admin.id,
    own.course.id,
    own.group.id,
    recovery.sessionId,
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
    attendance,
    adminId: admin.id,
    instructorId: teacher.id,
    courseId: own.course.id,
    groupId: own.group.id,
    session: current.session,
    pastSession: calendar.sessions.find((row) => row.id !== original.id)!,
    paid,
    partial,
    foreign,
    async close() {
      // Keep append-only evidence; retire only these fixtures' courses so later
      // E2Es do not inherit active assignments on the shared isolated actor.
      try {
        for (const id of courseIds)
          await db
            .update(schema.courses)
            .set({ status: "ARCHIVED" })
            .where(eq(schema.courses.id, id));
      } finally {
        await database.close();
      }
    },
  };
}
