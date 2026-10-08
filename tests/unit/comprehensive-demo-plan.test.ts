import { expect, test } from "bun:test";
import {
  comprehensiveDemoPlan,
  comprehensiveDemoId,
  parseComprehensiveArgs,
  assertComprehensiveTarget,
  assertComprehensiveRelease,
} from "../../scripts/comprehensive-demo-plan";
import { validateEvaluationComponents } from "@/domain/evaluations/rules";
import { PRODUCTION_PROJECT } from "../../scripts/financial-demo-plan";

test("bounded comprehensive plan uses independent deterministic identities, exact weights and Bolivia calendars", () => {
  for (const limit of [1, 3, 10, 20]) {
    const plan = comprehensiveDemoPlan("2026-10-08", limit, 25);
    expect(plan.samples).toHaveLength(8);
    expect(plan.samples.flatMap((s) => s.registrations)).toHaveLength(26);
    const ids = plan.samples.flatMap((s) => [
      s.course.id,
      ...s.groups.map((g) => g.id),
      ...s.components.map((c) => c.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const sample of plan.samples) {
      validateEvaluationComponents(sample.components);
      expect(sample.course.slug.startsWith("demo-comprehensive-v1-")).toBe(
        true,
      );
      expect(sample.course.name.startsWith("[DEMO]")).toBe(true);
      expect(sample.course.registrationStartAt.getTime()).toBeLessThan(
        sample.fixtureClock.getTime(),
      );
      expect(sample.fixtureClock.getTime()).toBeLessThan(
        sample.course.registrationEndAt.getTime(),
      );
      expect(sample.course.registrationEndAt.getTime()).toBeLessThan(
        sample.course.startsAt.getTime(),
      );
    }
    expect(plan.formats[0]!.totalHours).toBeGreaterThan(limit + 1);
    expect(
      plan.samples.find((s) => s.key === "closed")!.course.endsAt.getTime(),
    ).toBeLessThan(plan.now.getTime());
    expect(new Set(plan.samples.map((s) => s.components.length))).toEqual(
      new Set([2, 6, 8]),
    );
  }
  expect(comprehensiveDemoId("manifest")).toBe(comprehensiveDemoId("manifest"));
  expect(() => comprehensiveDemoPlan("2026-10-08", 21, 25)).toThrow();
  expect(() => comprehensiveDemoPlan("2026-10-08", 3, 0)).toThrow();
  expect(() => comprehensiveDemoPlan("2026-02-30", 3, 25)).toThrow();
});

test("production cannot run from an unreleased feature tree or a dirty/unapproved source", () => {
  const sha = "a".repeat(40);
  expect(() =>
    assertComprehensiveRelease("master", sha, "", sha),
  ).not.toThrow();
  expect(() =>
    assertComprehensiveRelease("feat/comprehensive-demo-seed", sha, "", sha),
  ).toThrow();
  expect(() =>
    assertComprehensiveRelease(
      "master",
      sha,
      " M scripts/comprehensive-demo.ts",
      sha,
    ),
  ).toThrow();
  expect(() =>
    assertComprehensiveRelease("master", sha, "", "b".repeat(40)),
  ).toThrow();
  expect(() => assertComprehensiveRelease("master", sha, "", "")).toThrow();
});

test("CLI requires explicit destination; rejects resets, repeated flags and accidental production", () => {
  expect(() => parseComprehensiveArgs([])).toThrow();
  expect(() =>
    parseComprehensiveArgs([
      "--target",
      "local",
      "--project",
      "local",
      "--apply",
      "--apply",
    ]),
  ).toThrow();
  expect(() =>
    parseComprehensiveArgs([
      "--target",
      "local",
      "--project",
      "local",
      "--reset",
    ]),
  ).toThrow();
  expect(
    parseComprehensiveArgs(["--target", "local", "--project", "local"]).apply,
  ).toBe(false);
  const db = `postgresql://postgres:synthetic@db.${PRODUCTION_PROJECT}.supabase.co:5432/postgres`;
  const api = `https://${PRODUCTION_PROJECT}.supabase.co`;
  expect(() =>
    assertComprehensiveTarget("production", PRODUCTION_PROJECT, db, api, false),
  ).toThrow();
  expect(() =>
    assertComprehensiveTarget("production", "another-project", db, api, true),
  ).toThrow();
  expect(() =>
    assertComprehensiveTarget(
      "production",
      PRODUCTION_PROJECT,
      db,
      "https://other.supabase.co",
      true,
    ),
  ).toThrow();
  expect(() =>
    assertComprehensiveTarget("production", PRODUCTION_PROJECT, db, api, true),
  ).not.toThrow();
  expect(() =>
    assertComprehensiveTarget(
      "qa",
      "local",
      "postgres://localhost:55322/postgres",
      "http://127.0.0.1:55321",
      false,
    ),
  ).toThrow();
});
