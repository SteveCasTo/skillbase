import { expect, test } from "bun:test";
import {
  assertFinancialTarget,
  financialDemoPlan,
  financialDemoId,
  PRODUCTION_PROJECT,
} from "../../scripts/financial-demo-plan";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";

test("versioned plan is stable, synthetic, minimum-aware and uses valid group duration", () => {
  const plan = financialDemoPlan("2026-10-04", 25);
  expect(financialDemoPlan("2026-10-04", 25)).toEqual(plan);
  expect(plan.samples).toHaveLength(4);
  expect(plan.samples.flatMap((s) => s.registrations)).toHaveLength(11);
  expect(plan.samples[0]!.course.endsAt.getTime()).toBeLessThan(
    Date.parse("2026-10-04T04:00:00Z"),
  );
  expect(plan.samples[1]!.course.startsAt.getTime()).toBeLessThan(
    Date.parse("2026-10-04T04:00:00Z"),
  );
  expect(plan.samples[1]!.course.endsAt.getTime()).toBeGreaterThan(
    Date.parse("2026-10-04T04:00:00Z"),
  );
  expect(plan.samples[2]!.course.startsAt.getTime()).toBeGreaterThan(
    Date.parse("2026-10-04T04:00:00Z"),
  );
  for (const sample of plan.samples) {
    expect(sample.fixtureClock.getTime()).toBeLessThanOrEqual(
      Date.parse("2026-10-04T04:00:00Z"),
    );
    expect(sample.fixtureClock.getTime()).toBeGreaterThanOrEqual(
      sample.course.registrationStartAt.getTime(),
    );
    expect(sample.fixtureClock.getTime()).toBeLessThan(
      sample.course.registrationEndAt.getTime(),
    );
    for (const group of sample.groups) {
      const start = instantToBoliviaCivil(group.startsAt).slice(11);
      const end = instantToBoliviaCivil(group.endsAt).slice(11);
      expect([`${start}/${end}`]).toEqual([
        start === "12:00" ? "12:00/13:30" : "14:00/15:30",
      ]);
    }
    for (const r of sample.registrations) {
      expect(r.participant.ci.startsWith("00FD")).toBe(true);
      expect(r.participant.email.endsWith("@example.test")).toBe(true);
      if (r.scenario === "partial") expect(r.amountCents).toBe(2000);
      if (r.scenario === "free") expect(r.amountCents).toBe(0);
    }
  }
  expect(
    financialDemoPlan("2026-10-05", 70).samples[0]!.registrations[1]!
      .amountCents,
  ).toBe(5600);
  expect(() => financialDemoPlan("2026-10-05", 100)).toThrow();
  expect(() => financialDemoPlan("2026-02-30", 25)).toThrow();
  expect(financialDemoId("manifest")).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/u,
  );
});

test("explicit connection identity rejects other projects and arbitrary local databases", () => {
  const api = `https://${PRODUCTION_PROJECT}.supabase.co`;
  expect(() =>
    assertFinancialTarget(
      "production",
      `postgres://postgres:private@db.${PRODUCTION_PROJECT}.supabase.co:5432/postgres`,
      api,
      PRODUCTION_PROJECT,
    ),
  ).not.toThrow();
  expect(() =>
    assertFinancialTarget(
      "production",
      `postgres://postgres.${PRODUCTION_PROJECT}:private@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
      api,
      PRODUCTION_PROJECT,
    ),
  ).not.toThrow();
  expect(() =>
    assertFinancialTarget(
      "local",
      "postgres://postgres:private@127.0.0.1:55322/postgres",
      "http://127.0.0.1:55321",
      "local",
    ),
  ).not.toThrow();
  for (const [target, url, project] of [
    ["local", "postgres://postgres:private@127.0.0.1:54322/postgres", "local"],
    ["local", "postgres://postgres:private@localhost:55322/postgres", "local"],
    [
      "production",
      "postgres://postgres.other:private@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
      PRODUCTION_PROJECT,
    ],
    [
      "production",
      `postgres://postgres:private@db.${PRODUCTION_PROJECT}.supabase.co.attacker.test:5432/postgres`,
      PRODUCTION_PROJECT,
    ],
    [
      "production",
      `postgres://postgres:private@db.${PRODUCTION_PROJECT}.supabase.co:5432/postgres`,
      "other",
    ],
    [
      "",
      `postgres://postgres:private@db.${PRODUCTION_PROJECT}.supabase.co:5432/postgres`,
      PRODUCTION_PROJECT,
    ],
  ])
    expect(() => assertFinancialTarget(target!, url!, api, project!)).toThrow();
});
