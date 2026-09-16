export type CourseErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_TRANSITION"
  | "COURSE_NOT_FOUND"
  | "COURSE_ARCHIVED"
  | "COURSE_PRICES_INCOMPLETE"
  | "STALE_COURSE"
  | "SLUG_CONFLICT";

export class CourseDomainError extends Error {
  constructor(
    readonly code: CourseErrorCode,
    message: string,
    readonly fieldErrors: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "CourseDomainError";
  }
}
