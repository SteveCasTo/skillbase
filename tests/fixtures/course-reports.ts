import type { CourseReportSource } from "@/application/courses/course-report";

/** Synthetic aggregate inputs only; never reads or changes an environment. */
export function courseReportSource(): CourseReportSource {
  const start = new Date("2026-01-05T12:00:00Z");
  const end = new Date("2026-01-23T13:30:00Z");
  const course = {
    id: "course-a",
    name: "Programación, análisis y diseño de información",
    level: "INTERMEDIATE" as const,
    status: "PUBLISHED" as const,
    startsAt: start,
    endsAt: end,
    instructorName: "María José Álvarez Quiñónez",
    studentCents: "10000",
    externalCents: "15000",
    auxiliaryCents: "5000",
    weekdaysMask: 31,
  };
  const group = {
    id: "group-a",
    courseId: course.id,
    startsAt: start,
    endsAt: end,
    status: "PLANNED" as const,
    closed: true,
    lastVersion: 2,
    officialVersion: 2,
    officialParticipants: [
      {
        registrationId: "registration-a",
        participantId: "person-a",
        academicallyPassed: false,
      },
    ],
  };
  const registration = {
    id: "registration-a",
    participantId: "person-a",
    courseId: course.id,
    groupId: group.id,
    state: "ACTIVE" as const,
    totalCents: "10000",
    paidCents: "10000",
    refundedCents: "1000",
  };
  return {
    courses: [
      course,
      {
        ...course,
        id: "course-b",
        name: "Diseño de sistemas históricos",
        status: "ARCHIVED",
      },
      {
        ...course,
        id: "course-c",
        name: "Borrador sin grupos",
        status: "DRAFT",
        instructorName: null,
        startsAt: new Date("2027-03-01T12:00:00Z"),
        endsAt: new Date("2027-03-19T13:30:00Z"),
      },
      { ...course, id: "course-d", name: "Curso sin inscritos" },
    ],
    groups: [
      group,
      {
        ...group,
        id: "group-b",
        startsAt: new Date("2026-01-05T14:00:00Z"),
        endsAt: new Date("2026-01-23T15:30:00Z"),
        closed: false,
      },
      {
        ...group,
        id: "group-c",
        courseId: "course-b",
        officialParticipants: [
          {
            registrationId: "registration-d",
            participantId: "person-a",
            academicallyPassed: true,
          },
        ],
      },
      { ...group, id: "group-d", courseId: "course-d", closed: false },
    ],
    sessions: [
      {
        groupId: group.id,
        startsAt: start,
        endsAt: new Date("2026-01-05T13:30:00Z"),
      },
      {
        groupId: group.id,
        startsAt: new Date("2026-01-24T14:00:00Z"),
        endsAt: new Date("2026-01-24T15:30:00Z"),
      },
    ],
    registrations: [
      registration,
      {
        ...registration,
        id: "registration-b",
        groupId: "group-b",
        refundedCents: "0",
      },
      {
        ...registration,
        id: "registration-c",
        participantId: "person-b",
        groupId: "group-b",
        totalCents: "0",
        paidCents: "0",
        refundedCents: "0",
      },
      {
        ...registration,
        id: "registration-d",
        courseId: "course-b",
        groupId: "group-c",
        totalCents: "3000",
        paidCents: "3000",
        refundedCents: "0",
      },
      {
        ...registration,
        id: "cancelled",
        participantId: "cancelled-person",
        state: "CANCELLED",
        paidCents: "10000",
        refundedCents: "0",
      },
      {
        ...registration,
        id: "balance",
        participantId: "balance-person",
        paidCents: "5000",
        refundedCents: "0",
      },
      {
        ...registration,
        id: "upcoming",
        participantId: "upcoming-person",
        courseId: "course-c",
        refundedCents: "0",
      },
    ],
  };
}
export const courseReportNow = new Date("2026-10-15T16:45:00Z");
