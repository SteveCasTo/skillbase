import { expect, test } from "bun:test";
import {
  parseInterestFilter,
  matchesInterestCourseFilter,
} from "@/server/interests/filter";
import { InterestError } from "@/domain/interests/rules";

test("interest course filters default to courses with demand", () => {
  for (const [query, expected] of [
    ["", "WITH"],
    ["status=ALL", "ALL"],
    ["status=WITH", "WITH"],
    ["status=WITHOUT", "WITHOUT"],
  ] as const)
    expect(parseInterestFilter(new URLSearchParams(query))).toBe(expected);
});
test("invalid, blank and repeated filters fail closed with a typed 400", () => {
  for (const query of [
    "status=",
    "status=active",
    "status=ARCHIVED",
    "status=ACTIVE&status=CANCELLED",
    "status=ALL&status=ALL",
  ]) {
    try {
      parseInterestFilter(new URLSearchParams(query));
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(InterestError);
      expect(error).toMatchObject({ status: 400, code: "INVALID_REQUEST" });
    }
  }
});
test("course demand filters distinguish zero from positive totals", () => {
  expect(matchesInterestCourseFilter(0, "WITH")).toBe(false);
  expect(matchesInterestCourseFilter(1, "WITH")).toBe(true);
  expect(matchesInterestCourseFilter(0, "WITHOUT")).toBe(true);
  expect(matchesInterestCourseFilter(2, "WITHOUT")).toBe(false);
  expect(matchesInterestCourseFilter(0, "ALL")).toBe(true);
  expect(matchesInterestCourseFilter(2, "ALL")).toBe(true);
});
