import { expect, test } from "bun:test";
import {
  attendanceDemoPlan,
  demoAttendanceStatus,
} from "../../scripts/attendance-demo-plan";
import {
  FINANCIAL_DEMO_OWNER,
  financialDemoId,
  fingerprint,
  type FinancialDemoContext,
} from "../../scripts/financial-demo-plan";
import { civilDay, attendanceSummary } from "@/domain/attendance/rules";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";

test("attendance plan preserves anchor, respects N/duration and separates unknown from confirmed evidence", () => {
  const financial: FinancialDemoContext = {
    owner: FINANCIAL_DEMO_OWNER,
    anchorDay: "2026-10-05",
    registrations: {},
    courses: {
      past: { courseId: financialDemoId("course:past"), groupIds: [] },
    },
  };
  const original = fingerprint(financial);
  const plan = attendanceDemoPlan(financial, 3);
  expect(attendanceDemoPlan(financial, 3)).toEqual(plan);
  expect(fingerprint(financial)).toBe(original);
  expect(
    plan.calendar.filter((row) => civilDay(row.startsAt) < plan.anchorDay),
  ).toHaveLength(5);
  expect(plan.reviewedCount).toBe(4);
  expect(plan.calendar).toHaveLength(13);
  expect(plan.format.studentAmount).toBe("0.00");
  for (const group of plan.groups)
    expect(instantToBoliviaCivil(group.endsAt).slice(11)).toBe(
      group.id === plan.groups[0]!.id ? "07:30" : "09:00",
    );
  const statuses = (key: string) =>
    Array.from({ length: plan.reviewedCount }, (_, i) =>
      demoAttendanceStatus(key, i),
    );
  expect(attendanceSummary(statuses("warning"), 3)).toMatchObject({
    warning: true,
    maximumConsecutiveAbsences: 3,
    academicallyEligible: true,
  });
  expect(attendanceSummary(statuses("flag"), 3)).toMatchObject({
    warning: true,
    maximumConsecutiveAbsences: 4,
    academicallyEligible: false,
  });
  expect(demoAttendanceStatus("justified", 0)).toBe("EXCUSED");
  expect(
    attendanceDemoPlan({ ...financial, anchorDay: "2026-10-04" }, 12).calendar
      .length,
  ).toBeGreaterThanOrEqual(18);
  expect(() => attendanceDemoPlan(financial, 995)).toThrow();
  expect(() =>
    attendanceDemoPlan({ ...financial, owner: "foreign" }, 3),
  ).toThrow();
});
