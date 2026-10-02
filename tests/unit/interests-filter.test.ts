import { expect, test } from "bun:test";
import { parseInterestFilter } from "@/server/interests/filter";
import { interestRequestGate } from "@/components/interests/admin-filter-client";
import { InterestError } from "@/domain/interests/rules";

test("interest filters accept only explicit states and the SSR Todos fallback", () => {
  for (const [query, expected] of [
    ["", undefined],
    ["status=ALL", undefined],
    ["status=ACTIVE", "ACTIVE"],
    ["status=CANCELLED", "CANCELLED"],
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
test("only the latest filter response may apply even after earlier fetch resolution", () => {
  const gate = interestRequestGate();
  const first = gate.begin();
  expect(first.isCurrent()).toBe(true);
  const second = gate.begin();
  expect(first.signal.aborted).toBe(true);
  expect(first.isCurrent()).toBe(false);
  expect(second.isCurrent()).toBe(true);
  first.abort(); // a previous request's timeout cannot abort its replacement
  expect(second.signal.aborted).toBe(false);
  gate.cancel();
  expect(second.isCurrent()).toBe(false);
});
