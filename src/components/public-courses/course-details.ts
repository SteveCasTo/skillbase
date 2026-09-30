import type { PublicCourseDto } from "@/domain/courses/types";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";

export type DisplayCourse = PublicCourseDto;

const dateOnly = new Intl.DateTimeFormat("es-BO", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "America/La_Paz",
});

export function civilDate(date: Date): string {
  return dateOnly.format(date);
}

export function registrationWindow(
  course: PublicCourseDto,
): { opens: string; closes: string } | null {
  if (!course.registrationStartAt || !course.registrationEndAt) return null;
  const end = course.registrationEndAt;
  // New civil-day windows end at the *start* of the following day. Keep
  // historical non-midnight closing instants on their actual Bolivia date.
  const closesAtMidnight =
    instantToBoliviaCivil(end).endsWith("T00:00") &&
    end.getUTCSeconds() === 0 &&
    end.getUTCMilliseconds() === 0;
  return {
    opens: civilDate(course.registrationStartAt),
    closes: civilDate(closesAtMidnight ? new Date(end.getTime() - 1) : end),
  };
}
