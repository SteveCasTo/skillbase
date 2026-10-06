import { getAdminCourse } from "@/application/courses/manage-courses";
import { listGroups } from "@/application/groups/manage-groups";
import { getAssignedCourse } from "@/application/instructors/assigned-courses";
import {
  getInstructorRoster,
  listRegistrations,
} from "@/application/pre-registrations/manage-registrations";
import { validateRegistrationId } from "@/domain/pre-registrations/validation";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import type {
  InstructorRosterEntryDto,
  RegistrationPageDto,
} from "@/domain/pre-registrations/types";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import { requireInternalUser } from "@/server/auth/context";
import { getDatabase } from "@/server/db/client";
import { DrizzleCourseRepository } from "@/server/db/repositories/course-repository";
import { DrizzleGroupRepository } from "@/server/db/repositories/group-repository";
import { DrizzleAssignedCourseRepository } from "@/server/db/repositories/assigned-course-repository";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";
import {
  registrationFailure,
  singleQuery,
} from "@/server/pre-registrations/http";

/** Resolve role and group ownership before querying or rendering a private roster. */
export async function prepareGroupParticipantsRoute(
  context: {
    locals: App.Locals;
    params: Record<string, string | undefined>;
    url: URL;
  },
  instructorRoute = false,
) {
  const actor = requireInternalUser(context.locals);
  const courseId = context.params.id ?? "",
    groupId = context.params.groupId ?? "";
  let courseName = "Curso",
    groupLabel = "Grupo",
    available = false;
  let entries: readonly InstructorRosterEntryDto[] = [];
  let registrations: RegistrationPageDto | null = null;
  try {
    validateRegistrationId(courseId, "courseId");
    validateRegistrationId(groupId, "groupId");
    const role = instructorRoute ? "INSTRUCTOR" : "ADMIN";
    if (actor.status !== "ACTIVE" || !actor.roles.includes(role))
      throw new RegistrationError("FORBIDDEN", "Acceso no autorizado.");
    const assigned = instructorRoute
      ? await getAssignedCourse(
          new DrizzleAssignedCourseRepository(getDatabase()),
          actor,
          courseId,
        )
      : null;
    const course = instructorRoute
      ? assigned?.course
      : await getAdminCourse(
          new DrizzleCourseRepository(getDatabase()),
          actor,
          courseId,
        );
    const groups = instructorRoute
      ? (assigned?.groups ?? [])
      : await listGroups(
          new DrizzleGroupRepository(getDatabase()),
          actor,
          courseId,
        );
    const index = groups.findIndex((group) => group.id === groupId);
    const group = groups[index];
    if (!course || !group)
      throw new RegistrationError("NOT_FOUND", "Grupo no disponible.");
    courseName = course.name;
    groupLabel = `Grupo ${index + 1} · ${instantToBoliviaCivil(group.startsAt).slice(11, 16)}`;
    available = !instructorRoute || new Date() >= course.startsAt;
    if (instructorRoute) {
      // No private roster query before official start; the repository rechecks ownership/start.
      if (available)
        entries = await getInstructorRoster(
          createRegistrationRepository(),
          actor,
          courseId,
          groupId,
        );
    } else {
      const rawPage = singleQuery(context.url.searchParams, "page") || "1";
      if (!/^\d+$/u.test(rawPage))
        throw new RegistrationError("VALIDATION_FAILED", "Página no válida.");
      registrations = await listRegistrations(
        createRegistrationRepository(),
        actor,
        { courseId, groupId, page: Number(rawPage), pageSize: 30 },
      );
    }
    return {
      status: 200,
      message: "",
      courseId,
      groupId,
      courseName,
      groupLabel,
      instructorRoute,
      available,
      entries,
      registrations,
    };
  } catch (error) {
    const failure = registrationFailure(error);
    return {
      status: failure.status,
      message: failure.payload.message,
      courseId,
      groupId,
      courseName,
      groupLabel,
      instructorRoute,
      available: false,
      entries: [],
      registrations: null,
    };
  }
}
