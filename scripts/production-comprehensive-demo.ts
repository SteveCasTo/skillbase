import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { runComprehensiveDemo } from "./comprehensive-demo";
import { runComprehensiveCertificates } from "./comprehensive-demo-certificates";
import {
  assertComprehensiveTarget,
  assertComprehensiveRelease,
} from "./comprehensive-demo-plan";
import {
  assertComprehensiveExecution,
  assertComprehensiveReleaseProof,
  assertReviewedPlan,
  assertProtectedDemoCredentials,
  type ReleaseProof,
} from "./comprehensive-demo-execution";
import {
  captureDemoSnapshot,
  assertDemoPreservation,
  assertDemoNoChanges,
  demoSnapshotSummary,
} from "./comprehensive-demo-preservation";
import { fingerprint, PRODUCTION_PROJECT } from "./financial-demo-plan";
import { verifyShardEvidence, type ShardEvidence } from "./e2e-shard-evidence";

const git = (args: string[]) => {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error("Git inspection failed");
  return result.stdout.trim();
};
async function releaseProof(env: NodeJS.ProcessEnv): Promise<ReleaseProof> {
  const sha = env.DEMO_APPROVED_RELEASE_SHA ?? "";
  const runId = env.DEMO_RELEASE_CI_RUN_ID ?? "";
  const projectId = env.VERCEL_PROJECT_ID ?? "";
  const teamId = env.VERCEL_ORG_ID ?? "";
  if (
    !/^\d+$/u.test(runId) ||
    !/^prj_[a-zA-Z0-9]+$/u.test(projectId) ||
    !/^team_[a-zA-Z0-9]+$/u.test(teamId) ||
    !env.GH_TOKEN ||
    !env.VERCEL_TOKEN ||
    !env.RUNNER_TEMP
  )
    throw new Error("Protected release evidence configuration required");
  const request = async (url: string, token: string): Promise<unknown> => {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("Release evidence read unavailable");
    return response.json();
  };
  const github = `https://api.github.com/repos/SteveCasTo/skillbase`;
  const ci = (await request(
    `${github}/actions/runs/${runId}`,
    env.GH_TOKEN,
  )) as ReleaseProof["ci"];
  const jobs = (await request(
    `${github}/actions/runs/${runId}/jobs?per_page=100`,
    env.GH_TOKEN,
  )) as { jobs: ReleaseProof["jobs"] };
  const branch = (await request(`${github}/branches/master`, env.GH_TOKEN)) as {
    commit: { sha: string };
  };
  // Resolve the CURRENT alias, not merely an old READY deployment for this SHA.
  const alias = (await request(
    `https://api.vercel.com/v4/aliases/skillbase-alpha.vercel.app?teamId=${teamId}`,
    env.VERCEL_TOKEN,
  )) as {
    alias: string;
    projectId: string;
    deploymentId: string | null;
    redirect?: string | null;
    deletedAt?: number | null;
  };
  if (
    alias.alias !== "skillbase-alpha.vercel.app" ||
    alias.projectId !== projectId ||
    alias.redirect ||
    alias.deletedAt ||
    !/^dpl_[a-zA-Z0-9]+$/u.test(alias.deploymentId ?? "")
  )
    throw new Error("Approved alias deployment unavailable");
  const deployment = (await request(
    `https://api.vercel.com/v13/deployments/${alias.deploymentId}?teamId=${teamId}`,
    env.VERCEL_TOKEN,
  )) as ReleaseProof["deployment"];
  const directory = join(
    env.RUNNER_TEMP,
    `comprehensive-release-evidence-${runId}-${crypto.randomUUID()}`,
  );
  const download = Bun.spawn(
    [
      "gh",
      "run",
      "download",
      runId,
      "--repo",
      "SteveCasTo/skillbase",
      "--pattern",
      "e2e-shard-*",
      "--dir",
      directory,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  await new Response(download.stderr).text(); // Provider messages may contain private details.
  if ((await download.exited) !== 0)
    throw new Error("First-pass E2E evidence unavailable");
  const shards: ShardEvidence[] = await Promise.all(
    [1, 2].map(async (shard) => {
      const path = join(directory, `e2e-shard-${shard}`, "e2e-evidence");
      return {
        inventory: await Bun.file(join(path, "inventory.json")).json(),
        outcomes: await Bun.file(join(path, "outcomes.json")).json(),
        execution: await Bun.file(join(path, "execution.json")).json(),
      };
    }),
  );
  const e2e = verifyShardEvidence(shards);
  const proof = {
    approvedSha: sha,
    remoteSha: branch.commit.sha,
    ci,
    jobs: jobs.jobs,
    deployment,
    projectId,
    e2e,
  };
  assertComprehensiveReleaseProof(proof);
  return proof;
}

if (import.meta.main) {
  let connection: ReturnType<typeof createDatabase> | undefined;
  let stage = "context";
  try {
    const env = process.env;
    assertComprehensiveExecution(
      env,
      true,
      "production",
      env.DEMO_PROJECT_REF ?? "",
    );
    assertComprehensiveRelease(
      git(["branch", "--show-current"]),
      git(["rev-parse", "HEAD"]),
      git(["status", "--porcelain"]),
      env.DEMO_APPROVED_RELEASE_SHA ?? "",
    );
    const mode = env.DEMO_OPERATOR_MODE ?? "";
    const includeCertificates = env.DEMO_INCLUDE_CERTIFICATES === "true";
    if (
      env.DEMO_INCLUDE_CERTIFICATES &&
      !["true", "false"].includes(env.DEMO_INCLUDE_CERTIFICATES)
    )
      throw new Error("Explicit certificate option required");
    if (mode !== "plan" && mode !== "apply")
      throw new Error("Explicit PLAN or APPLY required");
    stage = "release-proof";
    const proof = await releaseProof(env);
    stage = "target";
    const url = env.DEMO_DATABASE_URL ?? "";
    const api = env.DEMO_SUPABASE_URL ?? "";
    assertComprehensiveTarget("production", PRODUCTION_PROJECT, url, api, true);
    assertProtectedDemoCredentials(
      mode,
      env.DEMO_SUPABASE_SERVICE_ROLE_KEY,
      env.DEMO_ACCOUNT_PASSWORD,
    );
    connection = createDatabase(url, {
      max: 1,
      connectTimeout: 15,
      maxPipeline: 1,
    });
    const auth = createClient(api, env.DEMO_SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const options = {
      actorId: env.DEMO_ADMIN_ID ?? "",
      auth,
      password: env.DEMO_ACCOUNT_PASSWORD ?? "",
      apply: false,
    };
    stage = "readonly-plan";
    const before = await captureDemoSnapshot(connection.db);
    const settings = await connection.db.execute(
      sql`select (select row_to_json(a) from attendance_settings a where id=1) as attendance,(select row_to_json(r) from registration_settings r where id=1) as registration`,
    );
    let planHash = "";
    let reviewedPlan: unknown;
    let certificatePlanHash = "";
    let certificatePlan: unknown;
    if (includeCertificates)
      await runComprehensiveCertificates(connection.db, {
        ...options,
        verificationOrigin: "https://skillbase-alpha.vercel.app",
        preview(plan) {
          certificatePlanHash = fingerprint(plan);
          certificatePlan = plan;
        },
      });
    else
      await runComprehensiveDemo(connection.db, {
        ...options,
        preview(plan, existing) {
          planHash = fingerprint(plan);
          reviewedPlan = { plan, existing };
        },
      });
    const afterPlan = await captureDemoSnapshot(connection.db);
    assertDemoNoChanges(before, afterPlan);
    // Binds the actual anchor/scenarios, actor, current settings, original rows,
    // target and release. Any midnight/config/data drift requires a new PLAN.
    const approvalHash = fingerprint({
      release: proof.approvedSha,
      project: PRODUCTION_PROJECT,
      actor: options.actorId,
      plan: reviewedPlan,
      settings,
      baseline: before,
      ...(includeCertificates ? { includeCertificates, certificatePlan } : {}),
    });
    assertReviewedPlan(mode, env.DEMO_REVIEWED_PLAN_SHA256 ?? "", approvalHash);
    const report: Record<string, unknown> = {
      mode,
      release: proof.approvedSha,
      project: PRODUCTION_PROJECT,
      ciRun: env.DEMO_RELEASE_CI_RUN_ID,
      reviewedPlanSha256: approvalHash,
      planHash,
      before: demoSnapshotSummary(before),
      plan: reviewedPlan,
      status: "PLAN_VERIFIED",
      ...(includeCertificates ? { certificates: certificatePlan } : {}),
    };
    if (mode === "apply") {
      stage = "pre-apply-release-recheck";
      await releaseProof(env);
      assertDemoNoChanges(before, await captureDemoSnapshot(connection.db));
      stage = "first-apply";
      if (includeCertificates)
        await runComprehensiveCertificates(connection.db, {
          ...options,
          apply: true,
          verificationOrigin: "https://skillbase-alpha.vercel.app",
          expectedPlanHash: certificatePlanHash,
        });
      else
        await runComprehensiveDemo(connection.db, {
          ...options,
          apply: true,
          expectedPlanHash: planHash,
        });
      const first = await captureDemoSnapshot(connection.db);
      assertDemoPreservation(before, first);
      stage = "repeat-apply";
      if (includeCertificates)
        await runComprehensiveCertificates(connection.db, {
          ...options,
          apply: true,
          verificationOrigin: "https://skillbase-alpha.vercel.app",
        });
      else
        await runComprehensiveDemo(connection.db, {
          ...options,
          apply: true,
          expectedPlanHash: planHash,
        });
      const repeated = await captureDemoSnapshot(connection.db);
      assertDemoPreservation(before, repeated);
      assertDemoNoChanges(first, repeated);
      Object.assign(report, {
        status: "APPLY_VERIFIED",
        after: demoSnapshotSummary(repeated),
        originalRowsPreserved: demoSnapshotSummary(before).rows,
        repeatedApplyChanges: 0,
      });
    }
    // Artifact is summary/aggregate digests only: never per-row Auth witnesses,
    // database connection strings, actor identity, passwords or provider errors.
    const output = join(env.RUNNER_TEMP!, "comprehensive-demo-summary.json");
    await Bun.write(output, JSON.stringify(report, null, 2));
    console.info(
      JSON.stringify({
        status: report.status,
        mode,
        reviewedPlanSha256: approvalHash,
        before: report.before,
        after: report.after,
        repeatedApplyChanges: report.repeatedApplyChanges,
      }),
    );
  } catch {
    console.error(
      `Protected comprehensive demo stopped at ${stage}; internal provider/DB errors and credentials withheld. Do not reset or repair original rows. Review partial owned Auth state before any recovery.`,
    );
    process.exitCode = 1;
  } finally {
    await connection?.close();
  }
}
