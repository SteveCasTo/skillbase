import { expect, test } from "bun:test";
import { filterAvailableInterestCandidates } from "@/server/pre-registrations/prefill-interest-candidates";
import type { AdminInterestRegistrationDto } from "@/domain/interests/types";
import { normalizeRegistrationSearch } from "@/domain/pre-registrations/search";

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

test("search normalizes composed/decomposed accents, case and Unicode whitespace without changing identity", () => {
  expect(normalizeRegistrationSearch("  JOSÉ\u00a0\u2003Muñoz  ")).toBe(
    "jose munoz",
  );
  expect(normalizeRegistrationSearch("Jose\u0301 Mun\u0303oz")).toBe(
    "jose munoz",
  );
  expect(normalizeRegistrationSearch("  00AB\u00a0 -  x ")).toBe("00ab - x");
  expect(normalizeRegistrationSearch("  JOSÉ@EXAMPLE.INVALID ")).toBe(
    "jose@example.invalid",
  );
});

test("interest candidates normalize both sides, reject cancelled/foreign rows and deduplicate only IDs", () => {
  const first = { ...interest("first", "José\u00a0 María"), lastName: "Muñoz" };
  const homonym = { ...first, id: "homonym", email: "other@example.invalid" };
  const cancelled = { ...first, id: "cancelled", status: "CANCELLED" as const };
  const foreign = { ...first, id: "foreign", courseId: "other-course" };
  const rows = [first, first, homonym, cancelled, foreign];
  const ids = rows.map((row) => row.id);
  expect(
    filterAvailableInterestCandidates(
      rows,
      ids,
      "selected-course",
      "  JOSE\u2003 MARÍA   MUNOZ ",
    ),
  ).toEqual([first, homonym]);
  expect(
    filterAvailableInterestCandidates(rows, ids, undefined, "Jose"),
  ).toEqual([]);
  expect(
    filterAvailableInterestCandidates(
      rows,
      ids,
      "selected-course",
      " FIRST@EXAMPLE.INVALID ",
    ),
  ).toEqual([first]);
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
