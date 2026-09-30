import { expect, test } from "bun:test";
import { groupEndTime } from "../../src/components/courses/group-schedule-preview";

test("group end preview uses format duration, rejecting times that spill into the next day", () => {
  expect(groupEndTime("08:30", 90)).toBe("10:00");
  expect(groupEndTime("22:30", 90)).toBe(null);
  expect(groupEndTime("24:00", 60)).toBe(null);
  expect(groupEndTime("08:30", null)).toBe(null);
});
