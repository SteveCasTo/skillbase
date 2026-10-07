import type { AdminInterestRegistrationDto } from "@/domain/interests/types";
import { normalizeRegistrationSearch } from "@/domain/pre-registrations/search";

export function filterAvailableInterestCandidates(
  registrations: readonly AdminInterestRegistrationDto[],
  availableInterestIds: readonly string[],
  courseId: string | undefined,
  query: string,
) {
  const availableIds = new Set(availableInterestIds);
  const normalizedQuery = normalizeRegistrationSearch(query);
  const seenIds = new Set<string>();
  return registrations
    .filter(
      (interest) =>
        interest.status === "ACTIVE" &&
        interest.courseId === courseId &&
        availableIds.has(interest.id),
    )
    .filter((interest) =>
      normalizeRegistrationSearch(
        `${interest.firstName} ${interest.lastName} ${interest.email}`,
      ).includes(normalizedQuery),
    )
    .filter((interest) => {
      if (seenIds.has(interest.id)) return false;
      seenIds.add(interest.id);
      return true;
    })
    .slice(0, 30);
}
