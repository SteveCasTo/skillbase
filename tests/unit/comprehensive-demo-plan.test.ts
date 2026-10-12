import { expect, test } from "bun:test";
import {
  comprehensiveDemoPlan,
  legacyComprehensiveDemoPlan,
  comprehensiveDemoId,
  parseComprehensiveArgs,
  assertComprehensiveTarget,
  assertComprehensiveRelease,
  comprehensiveDemoVerificationOrigin,
} from "../../scripts/comprehensive-demo-plan";
import { validateEvaluationComponents } from "@/domain/evaluations/rules";
import { PRODUCTION_PROJECT } from "../../scripts/financial-demo-plan";
import { fingerprint } from "../../scripts/financial-demo-plan";
import { reviewedComprehensiveLocalTarget } from "../../scripts/comprehensive-demo-local-target";

test("bounded comprehensive plan uses independent deterministic identities, exact weights and Bolivia calendars", () => {
  for (const limit of [1, 3, 10, 20]) {
    const plan = comprehensiveDemoPlan("2026-10-08", limit, 25);
    expect(plan.samples).toHaveLength(12);
    expect(plan.samples.flatMap((s) => s.registrations)).toHaveLength(34);
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
      expect(sample.course.name).not.toContain("DEMO");
      expect(
        sample.registrations.every(
          (registration) =>
            registration.participant.paternalSurname !== "Demo" &&
            Boolean(registration.participant.maternalSurname),
        ),
      ).toBe(true);
      if (sample.registrations.length)
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
    const seasonal = plan.samples.filter((sample) =>
      sample.key.startsWith("next-"),
    );
    expect(seasonal).toHaveLength(4);
    expect(
      seasonal.every(
        (sample) => sample.course.startsAt.getUTCFullYear() === 2027,
      ),
    ).toBe(true);
    expect(plan.formats).toHaveLength(4);
  }
  expect(fingerprint(legacyComprehensiveDemoPlan("2026-10-08", 3, 25))).toBe(
    "f9b60d2b72babe0c8b84a3747ede4bc3ec8bf3bfb65579fe9b38e833463cdb6f",
  );
  expect(
    comprehensiveDemoPlan("2027-10-11", 3, 25)
      .samples.filter((sample) => sample.key.startsWith("next-"))
      .every((sample) => sample.course.startsAt.getUTCFullYear() === 2028),
  ).toBe(true);
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

test("certificate verification origin defaults to the local app and preserves production origin", () => {
  expect(comprehensiveDemoVerificationOrigin("local")).toBe(
    "http://127.0.0.1:4321",
  );
  expect(comprehensiveDemoVerificationOrigin("production")).toBe(
    "https://skillbase-alpha.vercel.app",
  );
});

test("CLI requires explicit destination; rejects resets, repeated flags and accidental production", () => {
  expect(() =>
    reviewedComprehensiveLocalTarget(
      "unused",
      "http://127.0.0.1:60421",
      "postgresql://postgres:synthetic@127.0.0.1:60422/postgres",
      "http://127.0.0.1:60421",
    ),
  ).toThrow("approved canonical local API");
  expect(() =>
    reviewedComprehensiveLocalTarget(
      "unused",
      "https://fvzxqlezdrlzykyoevub.supabase.co",
      "postgresql://postgres:synthetic@127.0.0.1:55322/postgres",
      "https://fvzxqlezdrlzykyoevub.supabase.co",
    ),
  ).toThrow("approved canonical local API");
  expect(
    parseComprehensiveArgs([
      "--target",
      "local",
      "--project",
      "local",
      "--local-config-workdir",
      "canonical-workdir",
      "--expected-local-api",
      "http://127.0.0.1:54321",
    ]).expectedLocalApi,
  ).toBe("http://127.0.0.1:54321");
  expect(() =>
    parseComprehensiveArgs([
      "--target",
      "local",
      "--project",
      "local",
      "--expected-local-api",
      "http://127.0.0.1:54321",
    ]),
  ).toThrow();
  expect(() =>
    parseComprehensiveArgs([
      "--target",
      "production",
      "--project",
      PRODUCTION_PROJECT,
      "--local-config-workdir",
      "canonical-workdir",
      "--expected-local-api",
      "http://127.0.0.1:54321",
    ]),
  ).toThrow();
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
