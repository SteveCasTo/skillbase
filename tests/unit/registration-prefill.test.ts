import { expect, test } from "bun:test";
import { filterAvailableInterestCandidates } from "@/server/pre-registrations/prefill-interest-candidates";
import type { AdminInterestRegistrationDto } from "@/domain/interests/types";

const interest = (
  id: string,
  firstName: string,
): AdminInterestRegistrationDto => ({
  id,
  courseId: "selected-course",
  firstName,
  lastName: "Origin",
  email: `${id}@example.invalid`,
  phone: null,
  preferredGroupId: null,
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

test("interest prefill lookup returns only available same-course candidates before limiting", () => {
  const consumedActive = interest("consumed-active", "Maria");
  const consumedCancelledRegistration = interest("consumed-cancelled", "Maria");
  const available = interest("available", "Maria");
  const otherCourse = interest("other-course", "Maria");

  expect(
    filterAvailableInterestCandidates(
      [
        ...Array.from({ length: 30 }, (_, index) =>
          interest(`consumed-${index}`, "Maria"),
        ),
        consumedActive,
        consumedCancelledRegistration,
        available,
        otherCourse,
      ],
      [available.id],
      "selected-course",
      "maria",
    ),
  ).toEqual([available]);
});
