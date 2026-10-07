import type { InternalUser } from "@/domain/auth/types";
import { listAdminCourses } from "@/application/courses/manage-courses";
import { getRegistrationForm } from "@/application/pre-registrations/manage-registrations";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";
import { DrizzleCourseRepository } from "@/server/db/repositories/course-repository";
import { getDatabase } from "@/server/db/client";
import { loadAdminInterestCourse } from "@/server/interests/http";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import type { RegistrationFormDto } from "@/domain/pre-registrations/types";
import { hasAvailableRegistrationDestination } from "@/domain/pre-registrations/policies";
import { filterAvailableInterestCandidates } from "./prefill-interest-candidates";
import { requireRegistrationAdmin } from "@/application/pre-registrations/authorization";

export async function loadRegistrationChoices(
  actor: InternalUser,
  now = new Date(),
): Promise<readonly RegistrationFormDto[]> {
  const courses = await listAdminCourses(
    new DrizzleCourseRepository(getDatabase()),
    actor,
  );
  const repository = createRegistrationRepository();
  const forms = await Promise.all(
    courses.map((course) => getRegistrationForm(repository, actor, course.id)),
  );
  return forms.filter(
    (form): form is RegistrationFormDto =>
      form !== null &&
      hasAvailableRegistrationDestination(
        {
          id: form.course.id,
          status: form.course.status,
          startsAt: new Date(form.course.startsAt),
          registrationEndAt: form.course.registrationEndAt
            ? new Date(form.course.registrationEndAt)
            : null,
          instructorActive: form.course.instructorActive,
          courseTypeRevisionId: form.course.courseTypeRevisionId,
          studentAmount: form.course.studentAmount,
          externalAmount: form.course.externalAmount,
        },
        form.groups.map((group) => ({
          id: group.id,
          courseId: form.course.id,
          courseTypeRevisionId: form.course.courseTypeRevisionId,
          status: group.status,
          capacity: group.capacity,
          occupied: group.occupied,
        })),
        now,
      ),
  );
}
export async function lookupRegistrationPeople(
  actor: InternalUser,
  search: string,
  courseId?: string,
) {
  if (search.trim().length < 2 || search.length > 100 || /\p{Cc}/u.test(search))
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Busca con 2 a 100 caracteres.",
    );
  requireRegistrationAdmin(actor);
  // Reauthorize against the current server identity without searching the global
  // participant directory. Missing/invalid course never produces global results.
  await createRegistrationRepository().settings(actor.id);
  const form = courseId
    ? await getRegistrationForm(createRegistrationRepository(), actor, courseId)
    : null;
  const data =
    form && form.course.status === "PUBLISHED" && form.course.instructorActive
      ? await loadAdminInterestCourse(actor, form.course.id, "ACTIVE")
      : null;
  const interests = filterAvailableInterestCandidates(
    data?.registrations ?? [],
    data?.availableForPrefillInterestIds ?? [],
    courseId,
    search,
  );
  return { participants: [], interests };
}
