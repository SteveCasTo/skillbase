import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getLocalSupabaseEnvironment } from "./supabase-local-env";
import { verifyLocalAuthConfiguration } from "./local-auth-config";
import {
  assertFinancialTarget,
  PRODUCTION_PROJECT,
  currentAnchor,
} from "./financial-demo-plan";
import { assertComprehensiveRelease } from "./comprehensive-demo-plan";
import { releaseProof } from "./production-comprehensive-demo";
import { FULL_VALIDATION_OWNER } from "./full-validation-seed-matrix";
import {
  prepareFullValidationNamesAndSettings,
  type ValidationNameEdit,
} from "./full-validation-prepare";
import {
  seedFullValidationBusiness,
  type FullValidationAccounts,
} from "./full-validation-business-seed";
import { seedCurrentValidationCertificates } from "./full-validation-certificates";
import { seedValidationInvitations } from "./full-validation-invitations";
import type { ComprehensiveDemoContext } from "./comprehensive-demo-plan";
import { fullValidationPlanHash } from "./full-validation-reset-plan";

function git(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error("Git context unavailable");
  return result.stdout.trim();
}
function external(path: string): string {
  const absolute = resolve(path),
    rel = relative(git(["rev-parse", "--show-toplevel"]), absolute);
  if (!rel.startsWith("..") && !isAbsolute(rel))
    throw new Error(
      "Private operator files must be outside the source checkout",
    );
  return absolute;
}
function editList(value: unknown): ValidationNameEdit[] {
  if (!Array.isArray(value))
    throw new Error("Reviewed name edit array required");
  return (value as unknown[]).map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("type" in entry) ||
      !("id" in entry) ||
      typeof entry.id !== "string"
    )
      throw new Error("Invalid profile plan");
    if (
      entry.type === "ADMIN" &&
      "name" in entry &&
      typeof entry.name === "string"
    )
      return { type: "ADMIN", id: entry.id, name: entry.name };
    if (
      entry.type === "INSTRUCTOR" &&
      "firstName" in entry &&
      typeof entry.firstName === "string" &&
      "lastName" in entry &&
      typeof entry.lastName === "string"
    )
      return {
        type: "INSTRUCTOR",
        id: entry.id,
        firstName: entry.firstName,
        lastName: entry.lastName,
      };
    throw new Error("Invalid reviewed profile components");
  });
}

/** Stage-by-stage manual operator. No reset/migration is hidden in seeding and
 * no stage obtains approval simply because a previous stage was approved. */
if (import.meta.main) {
  let connection: ReturnType<typeof createDatabase> | undefined;
  let stage = "arguments";
  try {
    const { values } = parseArgs({
      strict: true,
      options: {
        target: { type: "string" },
        project: { type: "string" },
        stage: { type: "string" },
        mode: { type: "string", default: "plan" },
        "actor-id": { type: "string" },
        "operation-id": { type: "string" },
        anchor: { type: "string" },
        output: { type: "string" },
        "local-config-workdir": { type: "string" },
        "name-plan": { type: "string" },
        "account-plan": { type: "string" },
        "reviewed-plan-sha256": { type: "string" },
        "allow-production": { type: "boolean", default: false },
        "allow-synthetic-final": { type: "boolean", default: false },
      },
    });
    const target = values.target,
      project = values.project,
      selected = values.stage,
      mode = values.mode;
    if (
      !["prepare", "business", "invitations", "certificates"].includes(
        selected ?? "",
      ) ||
      !["plan", "apply"].includes(mode ?? "") ||
      !values["actor-id"] ||
      !values["operation-id"] ||
      !values.output
    )
      throw new Error(
        "Explicit target/stage/mode/actor/operation/output required",
      );
    const output = external(values.output);
    const env = process.env;
    let databaseUrl: string, apiUrl: string, serviceKey: string;
    if (target === "local" && project === "skillbase") {
      if (env.CI || env.VERCEL || !values["local-config-workdir"])
        throw new Error(
          "Local operator requires explicit canonical configuration and non-CI execution",
        );
      const local = getLocalSupabaseEnvironment(values["local-config-workdir"]);
      if (
        local.apiUrl !== "http://127.0.0.1:54321" ||
        new URL(local.databaseUrl).hostname !== "127.0.0.1" ||
        new URL(local.databaseUrl).port !== "55322"
      )
        throw new Error("Canonical local target mismatch");
      await verifyLocalAuthConfiguration(values["local-config-workdir"]);
      ({ databaseUrl, apiUrl, serviceRoleKey: serviceKey } = local);
    } else if (
      target === "production" &&
      project === PRODUCTION_PROJECT &&
      values["allow-production"]
    ) {
      if (
        env.CI !== "true" ||
        env.GITHUB_ACTIONS !== "true" ||
        env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
        env.GITHUB_REPOSITORY !== "SteveCasTo/skillbase" ||
        env.GITHUB_REF !== "refs/heads/master" ||
        env.GITHUB_WORKFLOW_REF !==
          "SteveCasTo/skillbase/.github/workflows/production-full-validation.yml@refs/heads/master" ||
        env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA ||
        env.DEMO_APPROVED_RELEASE_SHA !== env.GITHUB_SHA
      )
        throw new Error("Exact protected manual production context required");
      assertComprehensiveRelease(
        git(["branch", "--show-current"]),
        git(["rev-parse", "HEAD"]),
        git(["status", "--porcelain"]),
        env.DEMO_APPROVED_RELEASE_SHA ?? "",
      );
      stage = "release-proof";
      await releaseProof(env);
      databaseUrl = env.DEMO_DATABASE_URL ?? "";
      apiUrl = env.DEMO_SUPABASE_URL ?? "";
      serviceKey = env.DEMO_SUPABASE_SERVICE_ROLE_KEY ?? "";
      assertFinancialTarget("production", databaseUrl, apiUrl, project);
    } else throw new Error("Explicit canonical destination required");
    if (!serviceKey)
      throw new Error("Protected server Storage/Auth credential unavailable");
    if (
      mode === "apply" &&
      (!/^[a-f0-9]{64}$/u.test(values["reviewed-plan-sha256"] ?? "") ||
        git(["status", "--porcelain"]))
    )
      throw new Error(
        "Clean source and exact reviewed stage hash required for APPLY",
      );
    connection = createDatabase(databaseUrl, { max: 1 });
    const db = connection.db;
    const auth = createClient(apiUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const common = {
      actorId: values["actor-id"],
      operationId: values["operation-id"],
      apply: mode === "apply",
      ...(values["reviewed-plan-sha256"]
        ? { reviewedPlanSha256: values["reviewed-plan-sha256"] }
        : {}),
    };
    stage = selected!;
    let result: unknown;
    if (selected === "prepare") {
      const edits = editList(
        await Bun.file(external(values["name-plan"] ?? "")).json(),
      );
      result = await prepareFullValidationNamesAndSettings(db, auth, {
        ...common,
        nameEdits: edits,
      });
    } else if (selected === "business") {
      const raw: unknown = await Bun.file(
        external(values["account-plan"] ?? ""),
      ).json();
      if (
        !raw ||
        typeof raw !== "object" ||
        !("instructors" in raw) ||
        !Array.isArray(raw.instructors) ||
        !raw.instructors.every((id: unknown) => typeof id === "string") ||
        !("operatorId" in raw) ||
        typeof raw.operatorId !== "string"
      )
        throw new Error("Reviewed retained account mapping required");
      const accounts: FullValidationAccounts = {
        instructors: raw.instructors as string[],
        operatorId: raw.operatorId,
      };
      const [reset] = await db
        .select()
        .from(s.auditEvents)
        .where(eq(s.auditEvents.id, common.operationId));
      const previous = await db
        .select()
        .from(s.auditEvents)
        .where(eq(s.auditEvents.entityId, common.operationId));
      const seeded = previous.find(
        (event) =>
          event.action === "VALIDATION_BUSINESS_SEEDED" &&
          event.metadata.owner === FULL_VALIDATION_OWNER,
      );
      // A supplied/frozen anchor is reused for replay, never rolled forward.
      const anchor =
        values.anchor ??
        (seeded?.metadata.anchorDay
          ? String(seeded.metadata.anchorDay)
          : currentAnchor());
      if (reset?.metadata.owner !== FULL_VALIDATION_OWNER)
        throw new Error("Approved reset receipt missing");
      result = await seedFullValidationBusiness(db, auth, {
        ...common,
        anchorDay: anchor,
        accounts,
      });
    } else if (selected === "invitations")
      result = await seedValidationInvitations(db, auth, common);
    else {
      const rows = await db
        .select()
        .from(s.auditEvents)
        .where(eq(s.auditEvents.entityId, common.operationId));
      const business = rows.find(
        (row) =>
          row.action === "VALIDATION_BUSINESS_SEEDED" &&
          row.metadata.owner === FULL_VALIDATION_OWNER,
      );
      if (!business || typeof business.metadata.context !== "string")
        throw new Error("Completed owned business context required");
      const context = JSON.parse(
        business.metadata.context,
      ) as ComprehensiveDemoContext;
      if (fullValidationPlanHash(context) !== business.metadata.contextSha256)
        throw new Error("Business context fingerprint changed");
      result = await seedCurrentValidationCertificates(db, auth, {
        ...common,
        context,
        verificationOrigin:
          target === "production"
            ? "https://skillbase-alpha.vercel.app"
            : "http://127.0.0.1:4321",
        allowSyntheticFinal: values["allow-synthetic-final"] ?? false,
      });
    }
    await Bun.write(
      output,
      JSON.stringify(
        {
          stage: selected,
          target,
          project,
          sourceSha: git(["rev-parse", "HEAD"]),
          result,
        },
        null,
        2,
      ),
    );
    const summary =
      result &&
      typeof result === "object" &&
      "mode" in result &&
      "planSha256" in result
        ? { mode: result.mode, planSha256: result.planSha256 }
        : { mode: "UNKNOWN" };
    console.info(
      JSON.stringify({ ...summary, stage: selected, target, project, output }),
    );
  } catch {
    console.error(
      `Full validation seed stopped at ${stage}; inspect receipts, do not repeat blindly or expose secrets.`,
    );
    process.exitCode = 1;
  } finally {
    if (connection) await connection.close();
  }
}
