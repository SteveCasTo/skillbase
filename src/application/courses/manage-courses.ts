import { requireRoles } from "@/application/auth/authorize";
import { createHash } from "node:crypto";
import { isUuid } from "@/domain/courses/mutation-result";
import type { CourseRepository } from "@/application/courses/course-repository";
import type { FormatRepository } from "@/application/courses/format-repository";
import { AuthorizationError } from "@/domain/auth/errors";
import type { InternalUser } from "@/domain/auth/types";
import { CourseDomainError } from "@/domain/courses/errors";
import { restoreDisabledCourseFields } from "@/domain/courses/form-input";
import {
  GROUP_SCHEDULE,
  planCourseDates,
  planWeekdaySchedule,
} from "@/domain/courses/weekday-schedule";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
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
  requestKey?: string,
) {
  requireAdmin(user);
  const data = validateCourseData(input);
  if (data.weekdaysMask !== 31)
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "Elige un horario de lunes a viernes.",
      {
        weekdays: "Las clases deben ser de lunes a viernes.",
      },
    );
  if (
    requestKey === undefined &&
    data.weekdaysMask != null &&
    data.startsAt.getTime() < Date.now()
  )
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "El inicio de un curso nuevo debe ser futuro.",
      { startsAt: "Selecciona una fecha futura." },
    );
  if (requestKey !== undefined && !isUuid(requestKey))
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "La clave de solicitud no es válida.",
    );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    )
    .digest("hex");
  return repository.create(
    data,
    user.id,
    requestKey ? { key: requestKey, fingerprint } : undefined,
  );
}

export async function updateCourse(
  repository: CourseRepository,
  user: InternalUser,
  id: string,
  input: CourseInput,
  formatRepository?: FormatRepository,
) {
  requireAdmin(user);
  const expected = parseRevision(input.revision);
  const course = await repository.getAdmin(id);
  if (!course)
    throw new CourseDomainError("COURSE_NOT_FOUND", "El curso no existe.");
  let restored = restoreDisabledCourseFields(input, course);
  const selectedFormat =
    input.startDate &&
    !input.endsAt &&
    course.editability?.format &&
    input.courseTypeId &&
    input.courseTypeId !== course.courseTypeId &&
    formatRepository
      ? await formatRepository.get(input.courseTypeId)
      : course;
  if (!selectedFormat)
    throw new CourseDomainError(
      "FORMAT_NOT_FOUND",
      "Selecciona un formato existente.",
      { courseTypeId: "Selecciona un formato existente." },
    );
  if (
    input.startDate &&
    course.weekdaysMask === 31 &&
    course.sessionMinutes !== null &&
    !course.editability?.schedule &&
    course.schedule !== GROUP_SCHEDULE &&
    (input.schedule === undefined || input.schedule === course.schedule)
  ) {
    const startsAt = `${input.startDate}T${instantToBoliviaCivil(course.startsAt).slice(11)}`;
    restored = {
      ...restored,
      startsAt,
      schedule: course.schedule,
      endsAt: instantToBoliviaCivil(
        planWeekdaySchedule({
          startsAt,
          weekdaysMask: 31,
          totalHours: course.totalHours,
          sessionMinutes: course.sessionMinutes,
        }).endsAt,
      ),
    };
  }
  if (
    input.startDate &&
    !input.endsAt &&
    course.weekdaysMask === 31 &&
    selectedFormat.sessionMinutes !== null &&
    course.schedule === GROUP_SCHEDULE
  ) {
    restored = {
      ...restored,
      endsAt: instantToBoliviaCivil(
        planCourseDates({
          startDate: input.startDate,
          weekdaysMask: 31,
          totalHours: selectedFormat.totalHours,
          sessionMinutes: selectedFormat.sessionMinutes,
        }).endsAt,
      ),
    };
  }
  return repository.update(id, validateCourseData(restored), user.id, expected);
}

export async function publishCourse(
  repository: CourseRepository,
  user: InternalUser,
  id: string,
  revision: string,
) {
  requireAdmin(user);
  return repository.transition(
    id,
    "PUBLISHED",
    user.id,
    parseRevision(revision),
  );
}

export async function withdrawCourse(
  repository: CourseRepository,
  user: InternalUser,
  id: string,
  revision: string,
) {
  requireAdmin(user);
  return repository.transition(id, "DRAFT", user.id, parseRevision(revision));
}

export async function archiveCourse(
  repository: CourseRepository,
  user: InternalUser,
  id: string,
  revision: string,
) {
  requireAdmin(user);
  return repository.transition(
    id,
    "ARCHIVED",
    user.id,
    parseRevision(revision),
  );
}

export async function featureCourse(
  repository: CourseRepository,
  user: InternalUser,
  id: string,
  revision: string,
) {
  requireAdmin(user);
  return repository.setFeatured(id, user.id, parseRevision(revision));
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
