import { boliviaCivilToInstant } from "@/domain/courses/bolivia-time";
import {
  GROUP_SCHEDULE,
  planCourseDates,
  planWeekdaySchedule,
} from "@/domain/courses/weekday-schedule";
import type { AttendanceStatus } from "@/domain/attendance/types";
import { groupPlan } from "@/domain/groups/rules";
import {
  financialDemoId,
  shiftedDay,
  validateAnchor,
  FINANCIAL_DEMO_OWNER,
  type FinancialDemoContext,
} from "./financial-demo-plan";

export const ATTENDANCE_DEMO_OWNER = "skillbase-attendance-demo-v1";
export const attendanceDemoId = (key: string) =>
  financialDemoId(`${ATTENDANCE_DEMO_OWNER}:${key}`);
export const ATTENDANCE_DEMO_TABLES = [
  "attendance_settings",
  "group_sessions",
  "session_roster",
  "participant_attendance",
  "instructor_attendance",
  "attendance_command_receipts",
] as const;
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
export function attendanceDemoPlan(
  financial: FinancialDemoContext,
  limit: number,
) {
  if (financial.owner !== FINANCIAL_DEMO_OWNER)
    throw new Error("Foreign financial fixture context");
  const anchorDay = validateAnchor(financial.anchorDay);
  // The existing planner caps calendars at 1000 sessions. Never lower global N
  // or manufacture extra attendance to fit a setting outside a bounded demo.
  if (!Number.isInteger(limit) || limit < 1 || limit > 994)
    throw new Error(
      "Attendance demo requires N between 1 and 994; global settings are unchanged",
    );
  let startDate = anchorDay;
  for (let count = 0; count < limit + 2;) {
    startDate = shiftedDay(startDate, -1);
    if (![0, 6].includes(weekday(startDate))) count++;
  }
  const format = {
    id: attendanceDemoId("format"),
    name: "Práctica abierta de asistencia",
    totalHours: Math.ceil((Math.max(13, limit + 6) * 90) / 60),
    sessionMinutes: 90,
    studentAmount: "0.00",
    externalAmount: "0.00",
  };
  const dates = planCourseDates({ startDate, weekdaysMask: 31, ...format });
  const course = {
    id: attendanceDemoId("course"),
    slug: "demo-asistencia-v1-practica",
    name: "Trabajo en equipo y participación",
    description:
      "Curso de demostración para explorar sesiones, asistencia y revisión administrativa con evidencia ficticia.",
    conditions:
      "Datos sintéticos de demostración; taller gratuito, sin oferta comercial real.",
    contentMarkdown:
      "## Programa\n\n- Participación\n- Práctica guiada\n- Trabajo colaborativo",
    level: "BASIC" as const,
    minimumGrade: 70,
    schedule: GROUP_SCHEDULE,
    weekdaysMask: 31,
    startsAt: dates.startsAt,
    endsAt: dates.endsAt,
    registrationStartAt: boliviaCivilToInstant(
      `${shiftedDay(startDate, -14)}T00:00`,
    ),
    registrationEndAt: boliviaCivilToInstant(
      `${shiftedDay(startDate, -1)}T23:59`,
    ),
    courseTypeRevisionId: attendanceDemoId("revision"),
    status: "PUBLISHED" as const,
    featured: false,
  };
  const enrollmentClock = boliviaCivilToInstant(
    `${shiftedDay(startDate, -8)}T10:00`,
  );
  const clock = boliviaCivilToInstant(`${anchorDay}T12:00`);
  const groups = ["06:00", "07:30"].map((time, i) => ({
    id: attendanceDemoId(`group:${i}`),
    courseId: course.id,
    courseTypeRevisionId: course.courseTypeRevisionId,
    capacity: 20,
    publishedAt: enrollmentClock,
    ...groupPlan({ ...dates, weekdaysMask: 31 }, format, time),
  }));
  const participants = ["present", "warning", "flag", "justified"].map(
    (key, i) => ({
      key,
      requestKey: attendanceDemoId(`registration:${key}`),
      participant: {
        ci: `00AD${String(i + 1).padStart(3, "0")}LP`,
        firstName: ["Valeria", "Gabriel", "Camila", "Nicolás"][i]!,
        lastName: "Ejemplo",
        email: `asistencia.v1.${key}@example.test`,
        phone: null,
      },
    }),
  );
  const calendar = planWeekdaySchedule({
    startsAt: `${startDate}T06:00`,
    weekdaysMask: 31,
    ...format,
  });
  let weekendDay = shiftedDay(anchorDay, 1);
  while (weekday(weekendDay) !== 6) weekendDay = shiftedDay(weekendDay, 1);
  return {
    owner: ATTENDANCE_DEMO_OWNER,
    anchorDay,
    limit,
    clock,
    enrollmentClock,
    format,
    course,
    groups,
    participants,
    calendar: calendar.sessions,
    todayReplacementAt: `${anchorDay}T04:00`,
    weekendReplacementAt: `${weekendDay}T04:00`,
    reviewedCount: limit + 1,
    recordRequestKeys: Array.from({ length: limit + 1 }, (_, i) =>
      attendanceDemoId(`record:${i}`),
    ),
    sessionRequestKeys: ["replace:today", "replace:weekend", "cancel"].map(
      attendanceDemoId,
    ),
  };
}
export type AttendanceDemoPlan = ReturnType<typeof attendanceDemoPlan>;
export function demoAttendanceStatus(
  key: string,
  index: number,
): AttendanceStatus {
  if (key === "flag" || (key === "warning" && index > 0)) return "ABSENT";
  if (key === "justified" && index === 0) return "EXCUSED";
  return "PRESENT";
}
export interface AttendanceDemoContext {
  readonly owner: string;
  readonly anchorDay: string;
  readonly consecutiveAbsenceLimit: number;
  readonly financialContextHash: string;
  readonly courseId: string;
  readonly groupIds: readonly string[];
  readonly registrations: Readonly<Record<string, string>>;
  readonly sessions: Readonly<Record<string, string>>;
}
