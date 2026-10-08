import { PRODUCTION_PROJECT } from "./financial-demo-plan";

export const COMPREHENSIVE_WORKFLOW =
  "SteveCasTo/skillbase/.github/workflows/production-comprehensive-demo.yml@refs/heads/master";
export function assertComprehensiveExecution(
  env: Readonly<Record<string, string | undefined>>,
  protectedManual: boolean,
  target: string,
  project: string,
): void {
  if (env.VERCEL) throw new Error("Vercel execution forbidden");
  if (!protectedManual) {
    if (env.CI && target !== "qa") throw new Error("Ordinary CI forbidden");
    return;
  }
  if (
    env.CI !== "true" ||
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REPOSITORY !== "SteveCasTo/skillbase" ||
    env.GITHUB_REF !== "refs/heads/master" ||
    env.GITHUB_WORKFLOW_REF !== COMPREHENSIVE_WORKFLOW ||
    !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? "") ||
    env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA ||
    env.DEMO_APPROVED_RELEASE_SHA !== env.GITHUB_SHA ||
    target !== "production" ||
    project !== PRODUCTION_PROJECT
  )
    throw new Error("Exact protected manual production context required");
}

export interface ReleaseProof {
  approvedSha: string;
  remoteSha: string;
  ci: {
    head_sha: string;
    head_branch: string;
    event: string;
    status: string;
    conclusion: string;
    path: string;
    run_attempt: number;
  };
  jobs: { name: string; conclusion: string }[];
  deployment: {
    readyState: string;
    projectId: string;
    target: string;
    meta: { githubCommitSha: string; githubCommitRef: string };
  };
  projectId: string;
  e2e: { flaky: number; retries: number };
}
export function assertComprehensiveReleaseProof(proof: ReleaseProof): void {
  const required = [
    "quality",
    "integration",
    "integration-e2e",
    "deploy",
    "e2e (1/2)",
    "e2e (2/2)",
  ];
  if (
    !/^[a-f0-9]{40}$/u.test(proof.approvedSha) ||
    proof.remoteSha !== proof.approvedSha ||
    proof.ci.head_sha !== proof.approvedSha ||
    proof.ci.head_branch !== "master" ||
    proof.ci.event !== "push" ||
    proof.ci.path !== ".github/workflows/ci.yml" ||
    proof.ci.status !== "completed" ||
    proof.ci.conclusion !== "success" ||
    proof.ci.run_attempt !== 1 ||
    required.some(
      (name) =>
        proof.jobs.filter(
          (job) => job.name === name && job.conclusion === "success",
        ).length !== 1,
    ) ||
    proof.deployment.readyState !== "READY" ||
    proof.deployment.target !== "production" ||
    proof.deployment.projectId !== proof.projectId ||
    !proof.projectId ||
    proof.deployment.meta.githubCommitSha !== proof.approvedSha ||
    proof.deployment.meta.githubCommitRef !== "master" ||
    proof.e2e.flaky !== 0 ||
    proof.e2e.retries !== 0
  )
    throw new Error(
      "Current master, first-pass full CI and exact READY production deployment required",
    );
}

export function assertReviewedPlan(
  mode: string,
  expected: string,
  actual: string,
): void {
  if (mode !== "plan" && mode !== "apply")
    throw new Error("Invalid operator mode");
  if (
    mode === "apply" &&
    (!/^[a-f0-9]{64}$/u.test(expected) || expected !== actual)
  )
    throw new Error(
      "Explicit matching reviewed PLAN hash required before APPLY",
    );
}

export function assertProtectedDemoCredentials(
  mode: string,
  key: string | undefined,
  password: string | undefined,
): void {
  if (
    !key ||
    (mode === "apply" &&
      (!password || password.length < 20 || password.length > 128))
  )
    throw new Error("Required protected credential unavailable");
}
