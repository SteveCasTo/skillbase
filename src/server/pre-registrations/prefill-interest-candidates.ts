import type { AdminInterestRegistrationDto } from "@/domain/interests/types";

export function filterAvailableInterestCandidates(
  registrations: readonly AdminInterestRegistrationDto[],
  availableInterestIds: readonly string[],
  courseId: string | undefined,
  query: string,
) {
  const availableIds = new Set(availableInterestIds);
  return registrations
    .filter(
      (interest) =>
        interest.courseId === courseId && availableIds.has(interest.id),
    )
    .filter((interest) =>
      `${interest.firstName} ${interest.lastName} ${interest.email}`
        .toLocaleLowerCase("es-BO")
        .includes(query),
    )
    .slice(0, 30);
}
