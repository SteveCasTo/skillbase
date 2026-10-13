import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve, relative, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import postgres from "postgres";
import {
  captureFullValidationResetInventory,
  captureNativeCloudValidationInventory,
} from "./full-validation-native-inventory";
import {
  fullValidationPlanHash,
  assertReviewedStorageObject,
} from "./full-validation-reset-plan";
import {
  fullValidationResetSql,
  type ReviewedBusinessReset,
} from "./full-validation-reset-sql";
import { getLocalSupabaseEnvironment } from "./supabase-local-env";
import { verifyLocalAuthConfiguration } from "./local-auth-config";

function git(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error("Source inspection failed");
  return result.stdout.trim();
}
function outsideSource(path: string): string {
  const absolute = resolve(path),
    root = git(["rev-parse", "--show-toplevel"]),
    rel = relative(root, absolute);
  if (!isAbsolute(absolute) || (!rel.startsWith("..") && !isAbsolute(rel)))
    throw new Error(
      "Private operator evidence must be outside the source repository",
    );
  return absolute;
}

/** Explicit operator-only CLI. PLAN never writes DB/Storage. RESET requires a
 * clean approved source SHA, successful combined CI and exact reviewed file/hash.
 * It clears no object bytes: per-object Storage cleanup is a separate recorded
 * phase after references have been safely disconnected. */
async function main() {
  let connection: postgres.Sql | undefined;
  let stage = "arguments";
  try {
    const { values } = parseArgs({
      options: {
        mode: { type: "string", default: "plan" },
        target: { type: "string" },
        project: { type: "string" },
        "actor-id": { type: "string" },
        output: { type: "string" },
        "local-config-workdir": { type: "string" },
        "plan-file": { type: "string" },
        "reviewed-plan-sha256": { type: "string" },
        "approved-source-sha": { type: "string" },
        "source-ci-run-id": { type: "string" },
        "allow-production": { type: "boolean", default: false },
      },
      strict: true,
    });
    const target = values.target,
      project = values.project,
      mode = values.mode;
    if (
      !["plan", "reset", "storage-cleanup"].includes(mode ?? "") ||
      !(
        (target === "local" && project === "skillbase") ||
        (target === "production" &&
          project === "fvzxqlezdrlzykyoevub" &&
          values["allow-production"])
      )
    )
      throw new Error("Explicit mode and canonical target/project required");
    const output = outsideSource(values.output ?? "");
    const sha = git(["rev-parse", "HEAD"]);
    if (mode !== "plan") {
      if (
        git(["status", "--porcelain"]) ||
        sha !== values["approved-source-sha"] ||
        !/^[a-f0-9]{40}$/u.test(sha)
      )
        throw new Error("Clean exact approved source required for RESET");
      const runId = values["source-ci-run-id"] ?? "";
      if (!/^\d+$/u.test(runId))
        throw new Error("Combined source CI run required");
      const check = spawnSync(
        "gh",
        [
          "run",
          "view",
          runId,
          "--repo",
          "SteveCasTo/skillbase",
          "--json",
          "headSha,status,conclusion,jobs",
        ],
        { encoding: "utf8", stdio: "pipe" },
      );
      if (check.status !== 0)
        throw new Error("Combined source CI evidence unavailable");
      const proof: unknown = JSON.parse(check.stdout);
      if (
        !proof ||
        typeof proof !== "object" ||
        !("headSha" in proof) ||
        proof.headSha !== sha ||
        !("status" in proof) ||
        proof.status !== "completed" ||
        !("conclusion" in proof) ||
        proof.conclusion !== "success" ||
        !("jobs" in proof) ||
        !Array.isArray(proof.jobs)
      )
        throw new Error("Exact combined source CI is not green");
      for (const name of [
        "quality",
        "integration",
        "e2e (1/2)",
        "e2e (2/2)",
        "integration-e2e",
      ]) {
        if (
          !proof.jobs.some(
            (job: unknown) =>
              job &&
              typeof job === "object" &&
              "name" in job &&
              job.name === name &&
              "conclusion" in job &&
              job.conclusion === "success",
          )
        )
          throw new Error("A required source gate is not green");
      }
    }
    stage = "target";
    if (target === "local") {
      const workdir = values["local-config-workdir"];
      if (!workdir)
        throw new Error(
          "Explicit canonical local configuration workdir required",
        );
      const local = getLocalSupabaseEnvironment(workdir);
      if (
        local.apiUrl !== "http://127.0.0.1:54321" ||
        new URL(local.databaseUrl).hostname !== "127.0.0.1" ||
        new URL(local.databaseUrl).port !== "55322"
      )
        throw new Error("Canonical local endpoint identity mismatch");
      await verifyLocalAuthConfiguration(workdir);
      connection = postgres(local.databaseUrl, { prepare: false, max: 1 });
    }
    stage = "inventory";
    if (mode === "plan") {
      const captured = connection
        ? await captureFullValidationResetInventory(connection)
        : await captureNativeCloudValidationInventory(
            project!,
            `${output}.inventory.sql`,
          );
      const plan: ReviewedBusinessReset = {
        mode: "PRE_MIGRATION_DISPOSABLE_BUSINESS_RESET",
        actorId: values["actor-id"] ?? "",
        operationId: randomUUID(),
        sourceSha: sha,
        target: target as "local" | "production",
        project: project as "skillbase" | "fvzxqlezdrlzykyoevub",
        ...captured,
      };
      const planSha256 = fullValidationPlanHash(plan);
      // Validate all exact old-schema ledger/FK/bucket/identifier prerequisites,
      // but generating this SQL does NOT authorize or execute it.
      fullValidationResetSql(plan, planSha256);
      await Bun.write(
        output,
        JSON.stringify(
          {
            plan,
            reviewedPlanSha256: planSha256,
            approvalRequired: true,
            sourceClean: !git(["status", "--porcelain"]),
            notes: [
              "No APPLY performed",
              "Fresh MAIN review and combined source CI required",
              "Storage hashes currently cover metadata, not byte downloads",
              "No Auth credentials/provider/session rows captured",
            ],
          },
          null,
          2,
        ),
      );
      console.info(
        JSON.stringify({
          mode: "PLAN",
          target,
          project,
          sourceSha: sha,
          reviewedPlanSha256: planSha256,
          businessTables: plan.inventory.tables.filter(
            (t) => t.classification === "business",
          ).length,
          objectCount: plan.inventory.objects.length,
          ledger: plan.inventory.ledger.length,
          output,
        }),
      );
    } else {
      stage = "reviewed-plan";
      const path = outsideSource(values["plan-file"] ?? "");
      const file: unknown = await Bun.file(path).json();
      if (
        !file ||
        typeof file !== "object" ||
        !("plan" in file) ||
        !file.plan ||
        typeof file.plan !== "object"
      )
        throw new Error("Reviewed reset plan file unavailable");
      const plan = file.plan as ReviewedBusinessReset;
      const hash = values["reviewed-plan-sha256"] ?? "";
      if (
        plan.target !== target ||
        plan.project !== project ||
        plan.sourceSha !== sha ||
        plan.actorId !== values["actor-id"] ||
        fullValidationPlanHash(plan) !== hash
      )
        throw new Error("Reviewed plan/source/actor/target mismatch");
      const statement = fullValidationResetSql(plan, hash);
      if (mode === "storage-cleanup") {
        stage = "storage-cleanup";
        const cleanupFile = `${output}.cleanup-receipt.json`;
        const completed = new Set<string>();
        if (await Bun.file(cleanupFile).exists()) {
          const receipt: unknown = await Bun.file(cleanupFile).json();
          if (
            !receipt ||
            typeof receipt !== "object" ||
            !("reviewedPlanSha256" in receipt) ||
            receipt.reviewedPlanSha256 !== hash ||
            !("completedPaths" in receipt) ||
            !Array.isArray(receipt.completedPaths) ||
            !receipt.completedPaths.every((v: unknown) => typeof v === "string")
          )
            throw new Error("Storage cleanup receipt conflicts");
          receipt.completedPaths.forEach((v: string) => completed.add(v));
        }
        const captured = connection
          ? await captureFullValidationResetInventory(connection)
          : await captureNativeCloudValidationInventory(
              project!,
              `${output}.cleanup-inventory.sql`,
            );
        const current = captured.inventory;
        // Cleanup must precede new fixture uploads/migrations. A changed ledger
        // or any recreated business references ends the maintenance window.
        if (
          fullValidationPlanHash(current.ledger) !==
            fullValidationPlanHash(plan.inventory.ledger) ||
          current.tables.some(
            (t) =>
              t.classification === "business" &&
              t.table !== "audit_events" &&
              t.count !== 0,
          )
        )
          throw new Error(
            "Business references or ledger changed before old-object cleanup",
          );
        const receiptSelect = `select exists(select 1 from public.audit_events where id='${plan.operationId}'::uuid and actor_id='${plan.actorId}'::uuid and action='VALIDATION_BUSINESS_RESET' and metadata->>'reviewedPlanSha256'='${hash}') as confirmed;`;
        const receiptSql = `begin transaction read only; ${receiptSelect} rollback;`;
        if (connection) {
          const rows =
            await connection.unsafe<{ confirmed: boolean }[]>(receiptSelect);
          if (!rows.some((row) => row.confirmed))
            throw new Error("Reset receipt not confirmed");
        } else {
          const check = spawnSync(
            process.execPath,
            [
              "x",
              "supabase",
              "db",
              "query",
              "--linked",
              "--project-ref",
              project!,
              "--output-format",
              "json",
              receiptSql,
            ],
            { encoding: "utf8", stdio: "pipe", timeout: 60000 },
          );
          if (check.status !== 0)
            throw new Error("Reset receipt read unavailable");
          const payload: unknown = JSON.parse(check.stdout);
          if (
            !payload ||
            typeof payload !== "object" ||
            !("rows" in payload) ||
            !Array.isArray(payload.rows) ||
            !payload.rows.some(
              (r: unknown) =>
                r &&
                typeof r === "object" &&
                "confirmed" in r &&
                r.confirmed === true,
            )
          )
            throw new Error("Reset receipt not confirmed");
        }
        const original = new Map(
          plan.inventory.objects.map((object) => [
            `${object.bucket}/${object.name}`,
            object,
          ]),
        );
        if (
          current.objects.some(
            (object) =>
              original.get(`${object.bucket}/${object.name}`)?.id !== object.id,
          )
        )
          throw new Error("Unknown new Storage object appeared; no deletion");
        for (const object of current.objects) {
          const expected = original.get(`${object.bucket}/${object.name}`);
          if (!expected) throw new Error("Unreviewed Storage object appeared");
          assertReviewedStorageObject(expected, object);
        }
        for (const object of plan.inventory.objects) {
          const key = `${object.bucket}/${object.name}`;
          const actual = current.objects.find(
            (row) => row.bucket === object.bucket && row.name === object.name,
          );
          if (!actual && !completed.has(key))
            throw new Error(
              "Old object disappeared without this cleanup receipt; inspect before resuming",
            );
          if (completed.has(key)) {
            if (actual)
              throw new Error(
                "Completed cleanup object reappeared; recovery inspection required",
              );
            continue;
          }
          if (!actual)
            throw new Error(
              "Approved object is missing without a completed receipt",
            );
          assertReviewedStorageObject(object, actual);
          // Re-read each object just before removing it. Storage has no atomic
          // cross-DB snapshot; this reviewed maintenance window stays exclusive.
          const immediate = connection
            ? await captureFullValidationResetInventory(connection)
            : await captureNativeCloudValidationInventory(
                project!,
                `${output}.immediate-inventory.sql`,
              );
          const immediateObject = immediate.inventory.objects.find(
            (row) => row.bucket === object.bucket && row.name === object.name,
          );
          for (const present of immediate.inventory.objects) {
            const expected = original.get(`${present.bucket}/${present.name}`);
            if (!expected || completed.has(`${present.bucket}/${present.name}`))
              throw new Error(
                "Unknown or completed Storage object reappeared; no deletion",
              );
            assertReviewedStorageObject(expected, present);
          }
          if (!immediateObject)
            throw new Error(
              "Approved object disappeared immediately before removal",
            );
          assertReviewedStorageObject(object, immediateObject);
          const args = ["x", "supabase", "storage", "rm"];
          if (target === "production")
            args.push("--linked", "--project-ref", project!);
          else
            args.push("--local", "--workdir", values["local-config-workdir"]!);
          args.push(`ss:///${key}`);
          const remove = spawnSync(process.execPath, args, {
            encoding: "utf8",
            stdio: "pipe",
            timeout: 60000,
          });
          if (remove.status !== 0)
            throw new Error(
              "Object removal acknowledgment unavailable; inspect receipt/object before retry",
            );
          completed.add(key);
          await Bun.write(
            cleanupFile,
            JSON.stringify(
              {
                operationId: plan.operationId,
                reviewedPlanSha256: hash,
                completedPaths: [...completed],
              },
              null,
              2,
            ),
          );
        }
        const after = connection
          ? await captureFullValidationResetInventory(connection)
          : await captureNativeCloudValidationInventory(
              project!,
              `${output}.cleanup-after.sql`,
            );
        if (after.inventory.objects.length !== 0)
          throw new Error("Old Storage cleanup incomplete");
        await Bun.write(
          output,
          JSON.stringify(
            {
              mode: "STORAGE_CLEANED",
              operationId: plan.operationId,
              reviewedPlanSha256: hash,
              objectCount: completed.size,
              target,
              project,
            },
            null,
            2,
          ),
        );
        console.info(
          JSON.stringify({
            mode: "STORAGE_CLEANED",
            target,
            project,
            objectCount: completed.size,
            output,
          }),
        );
        return;
      }
      stage = "reset-transaction";
      if (connection) {
        await connection.unsafe(statement);
      } else {
        const sqlPath = `${output}.reset.sql`;
        await Bun.write(sqlPath, statement);
        const reset = spawnSync(
          process.execPath,
          [
            "x",
            "supabase",
            "db",
            "query",
            "--linked",
            "--project-ref",
            project!,
            "--output-format",
            "json",
            "--file",
            sqlPath,
          ],
          { encoding: "utf8", stdio: "pipe", timeout: 90000 },
        );
        if (reset.status !== 0)
          throw new Error(
            "Reset acknowledgment unavailable; inspect durable operation receipt before any retry",
          );
      }
      await Bun.write(
        output,
        JSON.stringify(
          {
            mode: "RESET_COMMITTED",
            operationId: plan.operationId,
            reviewedPlanSha256: hash,
            sourceSha: sha,
            target,
            project,
            storageCleanupPending: plan.inventory.objects.map((object) => ({
              id: object.id,
              bucket: object.bucket,
              name: object.name,
            })),
            authAndInfrastructurePreserved: true,
          },
          null,
          2,
        ),
      );
      console.info(
        JSON.stringify({
          mode: "RESET_COMMITTED",
          operationId: plan.operationId,
          target,
          project,
          storageCleanupPending: plan.inventory.objects.length,
          output,
        }),
      );
    }
  } catch {
    console.error(
      `Full validation operator stopped at ${stage}; no blind retry or secret output.`,
    );
    process.exitCode = 1;
  } finally {
    if (connection) await connection.end();
  }
}

if (import.meta.main) await main();
