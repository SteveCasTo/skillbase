import { describe, expect, test } from "bun:test";
import {
  planWeekdaySchedule,
  weekdayMask,
} from "@/domain/courses/weekday-schedule";

describe("weekday schedule in Bolivia civil time", () => {
  test("rounds half-up, skips weekends and exposes planned vs configured duration", () => {
    const plan = planWeekdaySchedule({
      startsAt: "2027-03-01T18:00",
      weekdaysMask: weekdayMask([1, 2, 3, 4, 5]),
      totalHours: 20,
      sessionMinutes: 90,
    });
    expect(plan.sessionCount).toBe(13);
    expect(plan.configuredHours).toBe(20);
    expect(plan.plannedMinutes).toBe(1170);
    expect(plan.endTime).toBe("19:30");
    expect(plan.sessions[1]?.startsAt.toISOString()).toBe(
      "2027-03-02T22:00:00.000Z",
    );
    expect(plan.endsAt.toISOString()).toBe("2027-03-17T23:30:00.000Z");
    expect(
      planWeekdaySchedule({
        startsAt: "2027-03-01T08:00",
        weekdaysMask: 31,
        totalHours: 30,
        sessionMinutes: 150,
      }).sessionCount,
    ).toBe(12);
    expect(
      planWeekdaySchedule({
        startsAt: "2027-03-01T08:00",
        weekdaysMask: 31,
        totalHours: 1,
        sessionMinutes: 40,
      }).sessionCount,
    ).toBe(2);
  });

  test("rejects duplicates, weekends, unselected start, invalid civil date and overnight classes", () => {
    for (const days of [[1, 1], [0], [6], []])
      expect(() => weekdayMask(days)).toThrow();
    const base = {
      startsAt: "2027-03-01T18:00",
      weekdaysMask: 31,
      totalHours: 20,
      sessionMinutes: 90,
    };
    expect(() =>
      planWeekdaySchedule({ ...base, weekdaysMask: weekdayMask([2]) }),
    ).toThrow();
    expect(() =>
      planWeekdaySchedule({ ...base, startsAt: "2027-03-06T18:00" }),
    ).toThrow();
    expect(() =>
      planWeekdaySchedule({ ...base, startsAt: "2027-02-30T18:00" }),
    ).toThrow();
    expect(() =>
      planWeekdaySchedule({ ...base, totalHours: 2147483647 }),
    ).toThrow("máximo de 1000 sesiones");
    expect(() =>
      planWeekdaySchedule({
        ...base,
        weekdaysMask: 1,
        startsAt: "2027-03-01T23:00",
      }),
    ).toThrow();
  });

  test("uses Bolivia civil days across month boundaries, independent of the process timezone", () => {
    const plan = planWeekdaySchedule({
      startsAt: "2027-04-30T21:30",
      weekdaysMask: 31,
      totalHours: 1,
      sessionMinutes: 90,
    });
    expect(plan.endTime).toBe("23:00");
    expect(plan.endsAt.toISOString()).toBe("2027-05-01T03:00:00.000Z");
    expect(() =>
      planWeekdaySchedule({
        startsAt: "2027-04-30T23:00",
        weekdaysMask: 31,
        totalHours: 1,
        sessionMinutes: 90,
      }),
    ).toThrow();
  });
});
