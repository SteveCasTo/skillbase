import type { Course } from "./types";

export interface CourseEditability {
  readonly content: boolean;
  readonly format: boolean;
  readonly instructor: boolean;
  readonly dates: boolean;
  readonly schedule: boolean;
}

export function isCourseEditability(
  value: unknown,
): value is CourseEditability {
  return Boolean(
    value &&
    typeof value === "object" &&
    ["content", "format", "instructor", "dates", "schedule"].every(
      (key) => key in value && typeof Reflect.get(value, key) === "boolean",
    ),
  );
}

/** A read projection only; commands must derive it again under their locks. */
export function courseEditability(
  course: Pick<Course, "status" | "startsAt">,
  hasGroups: boolean,
  canReschedule: boolean,
  now: Date,
): CourseEditability {
  const content = course.status !== "ARCHIVED";
  return {
    content,
    format: content && course.status !== "PUBLISHED" && !hasGroups,
    instructor: content && course.startsAt > now,
    dates: content && course.startsAt > now && canReschedule,
    schedule: content && !hasGroups,
  };
}
