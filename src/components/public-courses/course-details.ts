import type { PublicCourseDto } from "@/domain/courses/types";

export type DisplayCourse = PublicCourseDto;

const dateTime = new Intl.DateTimeFormat("es-BO", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/La_Paz",
});

export function civilDate(date: Date): string {
  return dateTime.format(date);
}

export function registrationWindow(course: PublicCourseDto): string | null {
  if (!course.registrationStartAt || !course.registrationEndAt) return null;
  return `${civilDate(course.registrationStartAt)} — ${civilDate(course.registrationEndAt)}`;
}
