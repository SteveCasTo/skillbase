import { describe, expect, test } from "bun:test";
import {
  assertAttendanceDay,
  attendanceSummary,
  civilDay,
  effectiveAttendance,
  enrollmentActivatedAt,
  replacementInterval,
  validateAbsenceLimit,
} from "@/domain/attendance/rules";
import { boliviaCivilToInstant as civil } from "@/domain/courses/bolivia-time";
import { planWeekdaySchedule } from "@/domain/courses/weekday-schedule";
import { validateRecordAttendance } from "@/application/attendance/manage-attendance";
describe("attendance policies", () => {
  test("N warns, N+1 loses eligibility without a percentage", () => {
    expect(attendanceSummary(["ABSENT", "ABSENT", "ABSENT"], 3)).toMatchObject({
      warning: true,
      academicallyEligible: true,
      consecutiveAbsences: 3,
    });
    expect(
      attendanceSummary(["ABSENT", "ABSENT", "ABSENT", "ABSENT"], 3)
        .academicallyEligible,
    ).toBe(false);
    expect(
      attendanceSummary(["ABSENT", "ABSENT", "ABSENT", "ABSENT", "PRESENT"], 3),
    ).toMatchObject({ academicallyEligible: false, consecutiveAbsences: 0 });
    expect(
      attendanceSummary(["ABSENT", "ABSENT", "ABSENT", "ABSENT"], 4)
        .academicallyEligible,
    ).toBe(true);
    expect(
      attendanceSummary(["ABSENT", "ABSENT", "ABSENT", "PENDING"], 3),
    ).toMatchObject({ warning: true, consecutiveAbsences: 3 });
  });
  test("justified and present interrupt streaks; pending never becomes fabricated absence", () => {
    for (const status of ["PRESENT", "EXCUSED", "PENDING"] as const)
      expect(
        attendanceSummary(["ABSENT", "ABSENT", status, "ABSENT", "ABSENT"], 3)
          .maximumConsecutiveAbsences,
      ).toBe(2);
  });
  test("civil day boundary, historical exemption and real marks", () => {
    const start = civil("2026-10-02T08:00");
    expect(
      effectiveAttendance(null, start, false, civil("2026-10-02T23:59")),
    ).toBe("PENDING");
    expect(
      effectiveAttendance(null, start, false, civil("2026-10-03T00:00")),
    ).toBe("ABSENT");
    expect(
      effectiveAttendance(null, start, true, civil("2026-10-04T00:00")),
    ).toBe("PENDING");
    expect(
      effectiveAttendance("EXCUSED", start, true, civil("2026-10-04T00:00")),
    ).toBe("EXCUSED");
    expect(civilDay(new Date("2026-10-03T03:59:59Z"))).toBe("2026-10-02");
  });
  test("same-day instructor may mark before class but never future or past day", () => {
    const start = civil("2026-10-02T18:00");
    expect(() =>
      assertAttendanceDay(start, civil("2026-10-02T06:00"), false),
    ).not.toThrow();
    expect(() =>
      assertAttendanceDay(start, civil("2026-10-03T00:00"), false),
    ).toThrow();
    expect(() =>
      assertAttendanceDay(start, civil("2026-10-01T23:59"), true),
    ).toThrow();
    expect(() =>
      assertAttendanceDay(start, civil("2026-10-03T00:00"), true),
    ).not.toThrow();
  });
  test("policy is one positive integer field", () => {
    for (const count of [0, -1, 1.5, NaN, Infinity, 2147483648])
      expect(() => validateAbsenceLimit(count)).toThrow();
    expect(validateAbsenceLimit(3)).toBe(3);
  });
  test("fixed full sessions preserve configured format hours and weekday rounding", () => {
    const plan = planWeekdaySchedule({
      startsAt: "2026-10-05T08:00",
      weekdaysMask: 31,
      totalHours: 20,
      sessionMinutes: 90,
    });
    expect(plan.sessionCount).toBe(13);
    expect(plan.configuredHours).toBe(20);
    expect(plan.plannedMinutes).toBe(1170);
    expect(
      plan.sessions.every(
        (s) => s.endsAt.getTime() - s.startsAt.getTime() === 5400000,
      ),
    ).toBe(true);
  });
  test("replacement may be weekend or earlier; cannot cross midnight", () => {
    expect(replacementInterval("2026-10-04T06:00", 90).endsAt).toEqual(
      civil("2026-10-04T07:30"),
    );
    expect(() => replacementInterval("2026-10-04T23:00", 90)).toThrow();
  });
  test("membership settlement uses recording instants and free registration creation", () => {
    const created = civil("2026-09-20T08:00"),
      start = civil("2026-10-02T00:00"),
      paid = civil("2026-10-03T10:00");
    expect(
      enrollmentActivatedAt(created, start, 100, [
        { amountCents: 25, recordedAt: created },
        { amountCents: 75, recordedAt: paid },
      ]),
    ).toEqual(paid);
    expect(enrollmentActivatedAt(created, start, 0, [])).toEqual(start);
    expect(enrollmentActivatedAt(paid, start, 0, [])).toEqual(paid);
    expect(
      enrollmentActivatedAt(created, start, 100, [
        { amountCents: 25, recordedAt: created },
      ]),
    ).toBeNull();
  });
  test("duplicate marks, invalid state and revision rejected before persistence", () => {
    const command = {
      requestKey: crypto.randomUUID(),
      courseId: crypto.randomUUID(),
      groupId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      revision: 1,
    };
    const mark = {
      registrationId: crypto.randomUUID(),
      status: "PRESENT" as const,
    };
    expect(() =>
      validateRecordAttendance({ ...command, marks: [mark, mark] }),
    ).toThrow();
    expect(() =>
      validateRecordAttendance({ ...command, revision: 0, marks: [] }),
    ).toThrow();
    expect(() =>
      validateRecordAttendance({ ...command, marks: [mark] }),
    ).not.toThrow();
  });
});
