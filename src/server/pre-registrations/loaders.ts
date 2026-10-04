import type { InternalUser } from "@/domain/auth/types";
import { listAdminCourses } from "@/application/courses/manage-courses";
import {
  getRegistrationForm,
  findParticipants,
} from "@/application/pre-registrations/manage-registrations";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";
import { DrizzleCourseRepository } from "@/server/db/repositories/course-repository";
import { getDatabase } from "@/server/db/client";
import { loadAdminInterestCourse } from "@/server/interests/http";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import type { RegistrationFormDto } from "@/domain/pre-registrations/types";

export async function loadRegistrationChoices(
  actor: InternalUser,
): Promise<readonly RegistrationFormDto[]> {
  const courses = await listAdminCourses(
    new DrizzleCourseRepository(getDatabase()),
    actor,
  );
  const repository = createRegistrationRepository();
  const forms = await Promise.all(
    courses.map((course) => getRegistrationForm(repository, actor, course.id)),
  );
  return forms.filter((form): form is RegistrationFormDto => form !== null);
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
  // Fresh repository authorization precedes reading independent public-interest data.
  const participants = await findParticipants(
    createRegistrationRepository(),
    actor,
    search,
    30,
  );
  const data = courseId
    ? await loadAdminInterestCourse(actor, courseId, "ACTIVE")
    : null;
  const query = search.trim().toLocaleLowerCase("es-BO");
  const interests = (data?.registrations ?? [])
    .filter((interest) =>
      `${interest.firstName} ${interest.lastName} ${interest.email}`
        .toLocaleLowerCase("es-BO")
        .includes(query),
    )
    .slice(0, 30);
  return { participants, interests };
}
