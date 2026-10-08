import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  assertComprehensiveExecution,
  assertComprehensiveReleaseProof,
  assertReviewedPlan,
  assertProtectedDemoCredentials,
  COMPREHENSIVE_WORKFLOW,
  type ReleaseProof,
} from "../../scripts/comprehensive-demo-execution";
import {
  assertComprehensiveRelease,
  parseComprehensiveArgs,
} from "../../scripts/comprehensive-demo-plan";
import {
  assertDemoPreservation,
  assertDemoNoChanges,
  type DemoSnapshot,
} from "../../scripts/comprehensive-demo-preservation";

const sha = "a".repeat(40);
test("PLAN never needs the demo password; APPLY rejects absent, short or oversized secrets without exposing them", () => {
  expect(() =>
    assertProtectedDemoCredentials("plan", "synthetic-key", undefined),
  ).not.toThrow();
  expect(() =>
    assertProtectedDemoCredentials("plan", undefined, undefined),
  ).toThrow();
  for (const password of [undefined, "", "short", "a".repeat(129)])
    expect(() =>
      assertProtectedDemoCredentials("apply", "synthetic-key", password),
    ).toThrow();
  expect(() =>
    assertProtectedDemoCredentials("apply", "synthetic-key", "a".repeat(32)),
  ).not.toThrow();
});
const environment = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "SteveCasTo/skillbase",
  GITHUB_REF: "refs/heads/master",
  GITHUB_WORKFLOW_REF: COMPREHENSIVE_WORKFLOW,
  GITHUB_SHA: sha,
  GITHUB_WORKFLOW_SHA: sha,
  DEMO_APPROVED_RELEASE_SHA: sha,
};
test("ordinary CI remains denied; only explicit exact protected manual production context passes", () => {
  expect(() =>
    assertComprehensiveExecution(
      environment,
      false,
      "production",
      "fvzxqlezdrlzykyoevub",
    ),
  ).toThrow();
  expect(() =>
    assertComprehensiveExecution(
      environment,
      true,
      "production",
      "fvzxqlezdrlzykyoevub",
    ),
  ).not.toThrow();
  for (const key of Object.keys(environment)) {
    expect(() =>
      assertComprehensiveExecution(
        { ...environment, [key]: "wrong" },
        true,
        "production",
        "fvzxqlezdrlzykyoevub",
      ),
    ).toThrow();
    expect(() =>
      assertComprehensiveExecution(
        { ...environment, [key]: undefined },
        true,
        "production",
        "fvzxqlezdrlzykyoevub",
      ),
    ).toThrow();
  }
  for (const event of ["push", "pull_request", "schedule"])
    expect(() =>
      assertComprehensiveExecution(
        { ...environment, GITHUB_EVENT_NAME: event },
        true,
        "production",
        "fvzxqlezdrlzykyoevub",
      ),
    ).toThrow();
  expect(() =>
    assertComprehensiveExecution(
      { ...environment, VERCEL: "1" },
      true,
      "production",
      "fvzxqlezdrlzykyoevub",
    ),
  ).toThrow();
  expect(() =>
    assertComprehensiveExecution(
      {},
      true,
      "production",
      "fvzxqlezdrlzykyoevub",
    ),
  ).toThrow();
  expect(() =>
    assertComprehensiveExecution(environment, true, "local", "local"),
  ).toThrow();
  expect(() =>
    assertComprehensiveExecution(environment, true, "production", "other"),
  ).toThrow();
  expect(() =>
    assertComprehensiveExecution(
      {},
      false,
      "production",
      "fvzxqlezdrlzykyoevub",
    ),
  ).not.toThrow();
  expect(() => assertComprehensiveRelease("", sha, "", sha)).toThrow();
  expect(() =>
    assertComprehensiveRelease("master", sha, " M file", sha),
  ).toThrow();
  expect(
    parseComprehensiveArgs([
      "--target",
      "production",
      "--project",
      "fvzxqlezdrlzykyoevub",
      "--protected-manual",
    ]).protectedManual,
  ).toBe(true);
});
const proof = (): ReleaseProof => ({
  approvedSha: sha,
  remoteSha: sha,
  ci: {
    head_sha: sha,
    head_branch: "master",
    event: "push",
    status: "completed",
    conclusion: "success",
    path: ".github/workflows/ci.yml",
    run_attempt: 1,
  },
  jobs: [
    "quality",
    "integration",
    "integration-e2e",
    "deploy",
    "e2e (1/2)",
    "e2e (2/2)",
  ].map((name) => ({ name, conclusion: "success" })),
  deployment: {
    readyState: "READY",
    projectId: "prj_fixture",
    target: "production",
    meta: { githubCommitSha: sha, githubCommitRef: "master" },
  },
  projectId: "prj_fixture",
  e2e: { flaky: 0, retries: 0 },
});
test("live release proof rejects stale master, incomplete/foreign/retried CI and nonexact deployments", () => {
  expect(() => assertComprehensiveReleaseProof(proof())).not.toThrow();
  const mutate = (change: (p: ReleaseProof) => void) => {
    const p = proof();
    change(p);
    expect(() => assertComprehensiveReleaseProof(p)).toThrow();
  };
  mutate((p) => {
    p.remoteSha = "b".repeat(40);
  });
  mutate((p) => {
    p.ci.path = ".github/workflows/production-demo.yml";
  });
  mutate((p) => {
    p.ci.event = "pull_request";
  });
  mutate((p) => {
    p.ci.run_attempt = 2;
  });
  mutate((p) => {
    p.ci.head_sha = "b".repeat(40);
  });
  for (const state of ["failure", "cancelled", "skipped", "in_progress"])
    mutate((p) => {
      p.jobs[0]!.conclusion = state;
    });
  mutate((p) => {
    p.jobs.pop();
  });
  mutate((p) => {
    p.deployment.readyState = "BUILDING";
  });
  mutate((p) => {
    p.deployment.target = "preview";
  });
  mutate((p) => {
    p.deployment.projectId = "prj_other";
  });
  mutate((p) => {
    p.deployment.meta.githubCommitSha = "b".repeat(40);
  });
  mutate((p) => {
    p.e2e.flaky = 1;
  });
  mutate((p) => {
    p.e2e.retries = 1;
  });
});
test("APPLY requires explicit matching reviewed hash; snapshots enforce keys, values, multiplicity, ledger and exact rerun", () => {
  const hash = "a".repeat(64);
  expect(() => assertReviewedPlan("plan", "", hash)).not.toThrow();
  expect(() => assertReviewedPlan("apply", hash, hash)).not.toThrow();
  for (const expected of ["", "invalid", "b".repeat(64)])
    expect(() => assertReviewedPlan("apply", expected, hash)).toThrow();
  expect(() => assertReviewedPlan("reset", hash, hash)).toThrow();
  const original: DemoSnapshot = {
    tables: [
      {
        name: "auth.users",
        rows: [
          { keyHash: "k", rowHash: "v" },
          { keyHash: "k", rowHash: "v" },
        ],
      },
    ],
    ledger: [{ id: 1, hash: "migration", createdAt: "1" }],
  };
  const clone = () => structuredClone(original);
  const added = clone();
  added.tables[0]!.rows.push({ keyHash: "new", rowHash: "new" });
  expect(() => assertDemoPreservation(original, added)).not.toThrow();
  expect(() => assertDemoNoChanges(original, added)).toThrow();
  expect(() => assertDemoNoChanges(original, clone())).not.toThrow();
  const deleted = clone();
  deleted.tables[0]!.rows.pop();
  expect(() => assertDemoPreservation(original, deleted)).toThrow();
  const changed = clone();
  changed.tables[0]!.rows[0]!.rowHash = "changed";
  expect(() => assertDemoPreservation(original, changed)).toThrow();
  const ledger = clone();
  ledger.ledger[0]!.hash = "changed";
  expect(() => assertDemoPreservation(original, ledger)).toThrow();
  expect(() =>
    assertDemoPreservation(original, { tables: [], ledger: original.ledger }),
  ).toThrow();
});
test("dedicated workflow is manual master-only, protected and noncancelling; secrets stay inside the operator environment", () => {
  const workflow = Bun.YAML.parse(
    readFileSync(
      new URL(
        "../../.github/workflows/production-comprehensive-demo.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    concurrency: { group: string; "cancel-in-progress": boolean };
    jobs: {
      operator: {
        if: string;
        environment: string;
        steps: { env?: Record<string, string>; run?: string }[];
      };
    };
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
  expect(workflow.concurrency.group).toBe(
    "production-demo-fvzxqlezdrlzykyoevub",
  );
  expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  expect(workflow.jobs.operator.environment).toBe("production");
  expect(workflow.jobs.operator.if).toContain(
    "github.ref == 'refs/heads/master'",
  );
  const step = workflow.jobs.operator.steps.find(
    (s) => s.run === "bun scripts/production-comprehensive-demo.ts",
  )!;
  expect(step.env!.DEMO_DATABASE_URL).toBe(
    "${{ secrets.MIGRATION_DATABASE_URL }}",
  );
  expect(step.env!.DEMO_SUPABASE_SERVICE_ROLE_KEY).toBe(
    "${{ secrets.DEMO_SUPABASE_SERVICE_ROLE_KEY }}",
  );
  expect(step.env!.DEMO_REVIEWED_PLAN_SHA256).toBe(
    "${{ inputs.reviewed_plan_sha256 }}",
  );
  expect(step.env!.CI).toBeUndefined();
  expect(
    workflow.jobs.operator.steps.some((s) => s.run?.includes("unset CI")),
  ).toBe(false);
});
