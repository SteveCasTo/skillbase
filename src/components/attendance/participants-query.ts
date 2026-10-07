import { validateRegistrationFilter } from "@/application/pre-registrations/manage-registrations";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import { singleQuery } from "@/server/pre-registrations/http";

/** The roster uses registration search across all pages, scoped to this course/group. */
export function groupParticipantsQuery(
  url: URL,
  courseId: string,
  groupId: string,
) {
  const rawPage = singleQuery(url.searchParams, "page") || "1";
  if (!/^\d+$/u.test(rawPage))
    throw new RegistrationError("VALIDATION_FAILED", "Página no válida.");
  return validateRegistrationFilter({
    courseId,
    groupId,
    search: singleQuery(url.searchParams, "search") || "",
    page: Number(rawPage),
    pageSize: 30,
  });
}
