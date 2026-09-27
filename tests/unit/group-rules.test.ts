import { expect, test } from "bun:test";
import { assertCapacity, groupPlan, overlaps } from "@/domain/groups/rules";
import { boliviaCivilToInstant } from "@/domain/courses/bolivia-time";

const date = boliviaCivilToInstant;
const course = {
  startsAt: date("2027-03-01T18:00"),
  endsAt: date("2027-03-17T19:30"),
  weekdaysMask: 31,
};
const revision = { totalHours: 20, sessionMinutes: 90 };

test("group derives fixed weekday session count and last date from its local hour", () => {
  expect(groupPlan(course, revision, "08:00")).toMatchObject({
    startsAt: date("2027-03-01T08:00"),
    endsAt: date("2027-03-17T09:30"),
    endTime: "09:30",
    sessionCount: 13,
    plannedMinutes: 1170,
  });
  expect(
    overlaps(
      date("2027-03-01T08:00"),
      date("2027-03-17T09:30"),
      date("2027-03-01T09:30"),
      date("2027-03-17T11:00"),
    ),
  ).toBe(false);
  expect(
    overlaps(
      date("2027-03-01T08:00"),
      date("2027-03-17T09:30"),
      date("2027-03-01T09:29"),
      date("2027-03-17T10:59"),
    ),
  ).toBe(true);
});

test("group hours use shared course civil dates even when course has canonical date bounds", () => {
  const canonical = {
    ...course,
    startsAt: date("2027-03-01T00:00"),
    endsAt: date("2027-03-17T23:59"),
  };
  expect(groupPlan(canonical, revision, "14:30")).toMatchObject({
    startsAt: date("2027-03-01T14:30"),
    endsAt: date("2027-03-17T16:00"),
  });
  expect(() =>
    groupPlan(
      { ...canonical, endsAt: date("2027-03-18T23:59") },
      revision,
      "14:30",
    ),
  ).toThrow("fecha final");
});

test("invalid times, capacities and unresolved history cannot be planned", () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, 2_147_483_648])
    expect(() => assertCapacity(value)).toThrow();
  expect(() => assertCapacity(2_147_483_647)).not.toThrow();
  for (const hour of ["9:00", "24:00", "23:00", "08:60", "08:00Z"])
    expect(() => groupPlan(course, revision, hour)).toThrow();
  expect(() =>
    groupPlan({ ...course, weekdaysMask: null }, revision, "08:00"),
  ).toThrow();
  expect(() =>
    groupPlan(course, { ...revision, sessionMinutes: null }, "08:00"),
  ).toThrow();
});
