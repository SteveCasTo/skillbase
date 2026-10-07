import { createInstructorFixture } from "./instructors";
import type { AttendanceDatabase } from "@/server/db/repositories/attendance-calendar";
import * as s from "@/server/db/schema";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";
import { DrizzleAttendanceRepository } from "@/server/db/repositories/attendance-repository";

export async function createClosureFixture(
  db: AttendanceDatabase,
  clock: () => Date,
) {
  const admin = await createInstructorFixture(db);
  await db.insert(s.userRoles).values({ userId: admin.id, roleCode: "ADMIN" });
  const admin2 = await createInstructorFixture(db);
  await db.insert(s.userRoles).values({ userId: admin2.id, roleCode: "ADMIN" });
  const instructor = await createInstructorFixture(db);
  const foreign = await createInstructorFixture(db);
  const [format] = await db
    .insert(s.courseTypes)
    .values({ name: `Closure QA ${crypto.randomUUID()}` })
    .returning();
  const [revision] = await db
    .insert(s.courseTypeRevisions)
    .values({
      courseTypeId: format!.id,
      revisionNumber: 1,
      totalHours: 6,
      sessionMinutes: 90,
      studentAmount: "80",
      externalAmount: "100",
    })
    .returning();
  const [course] = await db
    .insert(s.courses)
    .values({
      name: "Synthetic closure course",
      slug: `closure-${crypto.randomUUID()}`,
      description: "Isolated QA only",
      level: "BASIC",
      courseTypeRevisionId: revision!.id,
      instructorId: instructor.id,
      schedule: "Lunes a viernes",
      weekdaysMask: 31,
      conditions: "Synthetic",
      startsAt: new Date("2099-03-02T04:00:00Z"),
      endsAt: new Date("2099-03-05T23:59:00-04:00"),
      minimumGrade: 70,
      status: "PUBLISHED",
      updatedAt: clock(),
    })
    .returning();
  const groups = await db
    .insert(s.groups)
    .values(
      [8, 10].map((hour) => ({
        courseId: course!.id,
        courseTypeRevisionId: revision!.id,
        capacity: 10,
        startsAt: new Date(`2099-03-02T${hour + 4}:00:00Z`),
        endsAt: new Date(`2099-03-05T${hour + 5}:30:00Z`),
        publishedAt: clock(),
      })),
    )
    .returning();
  const finance = createRegistrationRepository(db, clock);
  const settings = await finance.settings(admin.id);
  async function enroll(full: boolean, groupId = groups[0]!.id) {
    return finance.create(
      {
        requestKey: crypto.randomUUID(),
        courseId: course!.id,
        groupId,
        courseRevision: course!.updatedAt.toISOString(),
        settingsRevision: settings.revision,
        firstDayException: false,
        sourceInterestId: null,
        participantType: "STUDENT",
        participant: {
          ci: `CL-${crypto.randomUUID()}`,
          firstName: "Synthetic",
          lastName: crypto.randomUUID(),
          email: "closure@test.invalid",
          phone: null,
        },
        initialPayment: {
          amountCents: full ? 8000 : 2000,
          effectiveDate: null,
          reason: "Synthetic",
        },
      },
      admin.id,
    );
  }
  const paid = await enroll(true),
    unpaid = await enroll(false),
    otherGroup = await enroll(true, groups[1]!.id);
  const attendance = new DrizzleAttendanceRepository(db, clock);
  // Generate before the start: this is ordinary chronology, not historical review.
  const calendar = await attendance.getGroup(
    admin.id,
    course!.id,
    groups[0]!.id,
  );
  await attendance.getGroup(admin.id, course!.id, groups[1]!.id);
  return {
    admin,
    admin2,
    instructor,
    foreign,
    course: course!,
    groups,
    paid,
    unpaid,
    otherGroup,
    calendar,
    attendance,
    components: [
      {
        id: crypto.randomUUID(),
        name: "Evaluación libre",
        type: "THEORY" as const,
        weight: "100",
      },
    ],
  };
}
