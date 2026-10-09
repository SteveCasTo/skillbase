import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { DrizzleGroupRepository } from "@/server/db/repositories/group-repository";
import { DrizzleAttendanceRepository } from "@/server/db/repositories/attendance-repository";
import {
  planCourseDates,
  GROUP_SCHEDULE,
} from "@/domain/courses/weekday-schedule";
import { civilDay } from "@/domain/attendance/rules";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { AUTH_FIXTURES } from "./auth-users";

/** Twelve real planned sessions on the runner's verified isolated database only. */
export async function createSessionCalendarFixture() {
  const database = createDatabase(getTestSupabaseEnvironment().databaseUrl);
  const db = database.db;
  let courseId: string | undefined;
  let group: Awaited<ReturnType<DrizzleGroupRepository["create"]>> | undefined;
  let adminId: string | undefined;
  const groups = new DrizzleGroupRepository(db);
  async function close() {
    try {
      if (courseId)
        await db
          .update(schema.courses)
          .set({ status: "ARCHIVED" })
          .where(eq(schema.courses.id, courseId));
      if (group && adminId)
        await groups.cancel(group.id, adminId, group.updatedAt);
    } finally {
      await database.close();
    }
  }
  try {
    const [admin] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, AUTH_FIXTURES.admin.email));
    const [teacher] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, AUTH_FIXTURES.instructor.email));
    if (!admin || !teacher) throw new Error("Isolated calendar actors missing");
    adminId = admin.id;
    const [format] = await db
      .insert(schema.courseTypes)
      .values({ name: `Calendar E2E ${crypto.randomUUID()}` })
      .returning();
    const [revision] = await db
      .insert(schema.courseTypeRevisions)
      .values({
        courseTypeId: format!.id,
        revisionNumber: 1,
        totalHours: 18,
        sessionMinutes: 90,
        studentAmount: "80",
        externalAmount: "100",
      })
      .returning();
    const start = new Date(`${civilDay(new Date())}T12:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() + 60);
    while ([0, 6].includes(start.getUTCDay()))
      start.setUTCDate(start.getUTCDate() + 1);
    const dates = planCourseDates({
      startDate: civilDay(start),
      weekdaysMask: 31,
      totalHours: 18,
      sessionMinutes: 90,
    });
    const [course] = await db
      .insert(schema.courses)
      .values({
        name: `Calendar E2E ${crypto.randomUUID()}`,
        slug: `calendar-e2e-${crypto.randomUUID()}`,
        description: "Isolated long session calendar",
        level: "BASIC",
        courseTypeRevisionId: revision!.id,
        instructorId: teacher.id,
        schedule: GROUP_SCHEDULE,
        weekdaysMask: 31,
        conditions: "Synthetic",
        startsAt: dates.startsAt,
        endsAt: dates.endsAt,
        minimumGrade: 70,
        status: "PUBLISHED",
      })
      .returning();
    courseId = course!.id;
    group = await groups.create(courseId, "16:00", 5, adminId);
    const attendance = new DrizzleAttendanceRepository(db);
    const calendar = await attendance.getGroup(adminId, courseId, group.id);
    const first = calendar.sessions[0]!;
    await attendance.cancel(adminId, {
      requestKey: crypto.randomUUID(),
      courseId,
      groupId: group.id,
      sessionId: first.id,
      revision: first.revision,
      reason: "Calendar fixture cancellation",
    });
    return {
      courseId,
      groupId: group.id,
      calendar: await attendance.getGroup(adminId, courseId, group.id),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
