import { expect, test } from "bun:test";
import {
  planReconciliation,
  reconcileState,
  RECONCILIATION,
} from "../../scripts/reconcile-demo-courses";
import type { courses, courseTypeRevisions, groups } from "@/server/db/schema";

const now = new Date("2026-09-27T12:00:00Z");
const revision = {
  id: "revision",
  totalHours: 20,
  sessionMinutes: 90,
} as typeof courseTypeRevisions.$inferSelect;

test("plans exactly five forthcoming weekdays with valid windows and expected capacities", () => {
  expect(RECONCILIATION).toHaveLength(5);
  expect(new Set(RECONCILIATION.map((item) => item.slug)).size).toBe(5);
  for (const sample of RECONCILIATION) {
    const course = {
      slug: sample.slug,
      courseTypeRevisionId: revision.id,
      status: "PUBLISHED",
    } as typeof courses.$inferSelect;
    const planned = planReconciliation(course, revision, now);
    expect(planned.changes.weekdaysMask).toBe(31);
    expect(planned.changes.startsAt > now).toBe(true);
    expect(planned.groups.map((group) => group.capacity)).toEqual(
      sample.groups.map((group) => group.capacity),
    );
    expect(reconcileState(course, [], planned)).toBe("pending");
    if (sample.registration) {
      expect(
        planned.changes.registrationStartAt! <
          planned.changes.registrationEndAt!,
      ).toBe(true);
      expect(
        planned.changes.registrationEndAt! < planned.changes.startsAt,
      ).toBe(true);
    } else expect(planned.changes.registrationStartAt).toBeNull();
  }
});

test("rejects missing minutes, archived, elapsed dates and unexpected groups", () => {
  const course = {
    slug: RECONCILIATION[0]!.slug,
    courseTypeRevisionId: revision.id,
    status: "PUBLISHED",
  } as typeof courses.$inferSelect;
  expect(() =>
    planReconciliation(course, { ...revision, sessionMinutes: null }, now),
  ).toThrow();
  expect(() =>
    planReconciliation({ ...course, status: "ARCHIVED" }, revision, now),
  ).toThrow();
  expect(() =>
    planReconciliation(course, revision, new Date("2027-01-01")),
  ).toThrow();
  const planned = planReconciliation(course, revision, now);
  expect(() =>
    reconcileState(
      course,
      [{ status: "CANCELLED" } as typeof groups.$inferSelect],
      planned,
    ),
  ).toThrow();
});
