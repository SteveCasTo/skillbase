import { requireRoles } from "@/application/auth/authorize";
import type { CourseRepository } from "@/application/courses/course-repository";
import { AuthorizationError } from "@/domain/auth/errors";
import type { InternalUser } from "@/domain/auth/types";
import { CourseDomainError } from "@/domain/courses/errors";
import {
  validateCourseData,
  type CourseInput,
} from "@/domain/courses/validation";

function requireAdmin(user: InternalUser): void {
  if (user.status !== "ACTIVE")
    throw new AuthorizationError(
      user.status === "DISABLED" ? "DISABLED" : "NOT_INVITED",
      "Only active internal users can manage courses",
    );
  requireRoles(user, ["ADMIN"]);
}

function parseRevision(value: string | undefined): Date {
  const raw = value?.trim() ?? "";
  const revision = new Date(raw);
  if (
    !raw ||
    Number.isNaN(revision.getTime()) ||
    revision.toISOString() !== raw
  )
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "La revisión del curso no es válida. Recarga la página.",
      { revision: "Recarga la página antes de guardar." },
    );
  return revision;
}

export async function createCourse(
  repository: CourseRepository,
  user: InternalUser,
  input: CourseInput,
) {
  requireAdmin(user);
  return repository.create(validateCourseData(input), user.id);
}

export async function updateCourse(
  repository: CourseRepository,
  user: InternalUser,
  id: string,
  input: CourseInput,
) {
  requireAdmin(user);
  return repository.update(
    id,
    validateCourseData(input),
    user.id,
    parseRevision(input.revision),
  );
}

export async function publishCourse(
  repository: CourseRepository,
  user: InternalUser,
  id: string,
) {
  requireAdmin(user);
  return repository.transition(id, "PUBLISHED", user.id);
}

export async function withdrawCourse(
  repository: CourseRepository,
  user: InternalUser,
  id: string,
) {
  requireAdmin(user);
  return repository.transition(id, "DRAFT", user.id);
}

export async function archiveCourse(
  repository: CourseRepository,
  user: InternalUser,
  id: string,
) {
  requireAdmin(user);
  return repository.transition(id, "ARCHIVED", user.id);
}

export async function featureCourse(
  repository: CourseRepository,
  user: InternalUser,
  id: string,
) {
  requireAdmin(user);
  return repository.setFeatured(id, user.id);
}

export async function listAdminCourses(
  repository: CourseRepository,
  user: InternalUser,
) {
  requireAdmin(user);
  return repository.listAdmin();
}

export async function getAdminCourse(
  repository: CourseRepository,
  user: InternalUser,
  id: string,
) {
  requireAdmin(user);
  return repository.getAdmin(id);
}
