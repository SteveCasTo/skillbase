import { expect, test } from "bun:test";
import {
  assertCanonicalLocalTarget,
  formats,
  renewalPlan,
  RESET_TABLES,
  seedId,
} from "../../scripts/renew-demo-plan";
import { overlaps } from "@/domain/groups/rules";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";

test("CLI rejects cloud before discovery, suppresses supplied secrets and disallows implicit reset", () => {
  const sentinel = "DO_NOT_PRINT_SEED_CREDENTIAL_123";
  for (const args of [
    ["--apply", "--reset-application-data"],
    ["--reset-application-data"],
  ]) {
    const result = Bun.spawnSync(
      [process.execPath, "scripts/renew-demo.ts", ...args],
      {
        env: {
          ...process.env,
          DATABASE_URL: `postgres://postgres:${sentinel}@cloud.example:54322/postgres`,
          PUBLIC_SUPABASE_URL: "https://cloud.supabase.co",
          SEED_INSTRUCTOR_PASSWORD: sentinel,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString() + result.stderr.toString()).not.toContain(
      sentinel,
    );
    expect(result.stderr.toString()).toContain("refused or failed");
  }
});

test("renewal rejects noncanonical/cloud targets without touching a client", () => {
  for (const db of [
    "postgres://postgres:secret@cloud.example:54322/postgres",
    "postgres://postgres:secret@localhost:54322/postgres",
    "postgres://postgres:secret@127.0.0.1:5432/postgres",
    "postgres://postgres:secret@127.0.0.1:54322/other",
    "postgres://postgres:secret@127.0.0.1:54322/postgres?host=cloud.example",
    "invalid",
  ]) {
    expect(() =>
      assertCanonicalLocalTarget(db, "http://127.0.0.1:54321"),
    ).toThrow("canonical local");
  }
  expect(() =>
    assertCanonicalLocalTarget(
      "postgres://postgres:secret@127.0.0.1:54322/postgres",
      "https://cloud.supabase.co",
    ),
  ).toThrow();
  expect(() =>
    assertCanonicalLocalTarget(
      "postgres://postgres:secret@127.0.0.1:54322/postgres",
      "http://127.0.0.1:54321",
    ),
  ).not.toThrow();
  expect(RESET_TABLES).not.toContain("users");
  expect(RESET_TABLES).not.toContain("instructor_profiles");
});
test("stable future Bolivia plans and synthetic demand cases", () => {
  for (const now of [
    new Date("2026-10-01T02:00:00Z"),
    new Date("2035-12-31T23:00:00Z"),
  ]) {
    const plan = renewalPlan(now);
    expect(plan).toHaveLength(6);
    expect(plan.flatMap((x) => x.groups)).toHaveLength(12);
    expect(
      plan.flatMap((x) => x.interests).filter((x) => x.status === "ACTIVE"),
    ).toHaveLength(30);
    expect(
      plan.flatMap((x) => x.interests).filter((x) => x.status === "CANCELLED"),
    ).toHaveLength(5);
    const ids = plan.flatMap((x) => [
      x.course.id,
      ...x.groups.map((g) => g.id),
      ...x.interests.map((i) => i.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const sample of plan) {
      expect(sample.course.startsAt > now).toBe(true);
      expect(instantToBoliviaCivil(sample.course.startsAt).slice(11)).toBe(
        "00:00",
      );
      expect(
        sample.course.registrationEndAt === null ||
          sample.course.registrationEndAt < sample.course.startsAt,
      ).toBe(true);
      for (const interest of sample.interests)
        expect(
          interest.preferredGroupId === null ||
            sample.groups.some((g) => g.id === interest.preferredGroupId),
        ).toBe(true);
      for (const other of plan.filter((p) => p.teacher === sample.teacher))
        for (const group of sample.groups)
          for (const candidate of other.groups) {
            if (
              group.id !== candidate.id &&
              group.startsAt < candidate.endsAt &&
              candidate.startsAt < group.endsAt
            )
              expect(
                overlaps(
                  group.startsAt,
                  group.endsAt,
                  candidate.startsAt,
                  candidate.endsAt,
                ),
              ).toBe(false);
          }
    }
    expect(plan[3]!.interests).toHaveLength(0);
    const buckets = plan
      .slice(0, 3)
      .map((p) =>
        [p.groups[0]!.id, p.groups[1]!.id, null].map(
          (id) =>
            p.interests.filter(
              (i) => i.status === "ACTIVE" && i.preferredGroupId === id,
            ).length,
        ),
      );
    expect(buckets).toEqual([
      [8, 2, 1],
      [1, 1, 8],
      [3, 3, 3],
    ]);
  }
  expect(formats).toHaveLength(2);
  expect(seedId("demo-web")).toBe(renewalPlan(new Date())[0]!.course.id);
});
