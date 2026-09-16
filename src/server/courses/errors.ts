import { CourseDomainError } from "@/domain/courses/errors";
import { CourseInfrastructureError } from "@/server/db/repositories/course-infrastructure-error";

interface CourseErrorContext {
  readonly courseId?: string;
  readonly actorId: string;
}

export const COURSE_INFRASTRUCTURE_STATUS = 500;

export function courseDomainStatus(error: CourseDomainError): number {
  if (error.code === "COURSE_NOT_FOUND") return 404;
  if (
    error.code === "INVALID_TRANSITION" ||
    error.code === "COURSE_ARCHIVED" ||
    error.code === "COURSE_PRICES_INCOMPLETE" ||
    error.code === "STALE_COURSE"
  )
    return 409;
  return 422;
}

export function logCourseInfrastructureError(
  error: CourseInfrastructureError,
  context: CourseErrorContext,
): void {
  console.error("course_infrastructure_error", {
    operation: error.operation,
    errorName: error.name,
    actorId: context.actorId,
    ...(context.courseId ? { courseId: context.courseId } : {}),
  });
}
