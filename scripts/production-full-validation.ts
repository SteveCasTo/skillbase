import { join } from "node:path";

/** Protected transport only. Secrets remain in the child server process;
 * private plans, contacts and object paths never become public job artifacts. */
if (import.meta.main) {
  try {
    const env = process.env;
    if (
      !env.RUNNER_TEMP ||
      env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      env.GITHUB_REF !== "refs/heads/master" ||
      env.GITHUB_REPOSITORY !== "SteveCasTo/skillbase" ||
      env.GITHUB_WORKFLOW_REF !==
        "SteveCasTo/skillbase/.github/workflows/production-full-validation.yml@refs/heads/master"
    )
      throw new Error("Protected operator context required");
    const accounts = join(env.RUNNER_TEMP, "validation-accounts.json"),
      names = join(env.RUNNER_TEMP, "validation-names.json"),
      output = join(env.RUNNER_TEMP, "validation-private-stage.json");
    await Bun.write(accounts, env.VALIDATION_ACCOUNTS ?? "");
    await Bun.write(names, env.VALIDATION_NAME_EDITS ?? "[]");
    const args = [
      "scripts/full-validation-seed.ts",
      "--target",
      "production",
      "--project",
      "fvzxqlezdrlzykyoevub",
      "--allow-production",
      "--stage",
      env.VALIDATION_STAGE ?? "",
      "--mode",
      env.VALIDATION_MODE ?? "",
      "--actor-id",
      env.DEMO_ADMIN_ID ?? "",
      "--operation-id",
      env.VALIDATION_OPERATION_ID ?? "",
      "--anchor",
      env.VALIDATION_ANCHOR ?? "",
      "--account-plan",
      accounts,
      "--name-plan",
      names,
      "--output",
      output,
    ];
    if (env.VALIDATION_PLAN_SHA256)
      args.push("--reviewed-plan-sha256", env.VALIDATION_PLAN_SHA256);
    if (env.VALIDATION_SYNTHETIC_FINAL === "true")
      args.push("--allow-synthetic-final");
    const child = Bun.spawn([process.execPath, ...args], {
      env: { ...env, VALIDATION_SAFE_PROGRESS: "true" },
      stdout: "pipe",
      stderr: "pipe",
    });
    // Stream ONLY schema-validated counters/known phases. Never forward raw
    // child stderr/stdout, SQL, bound values, provider errors or environment.
    const knownPhases = new Set([
      "arguments",
      "release-proof",
      "prepare",
      "business",
      "invitations",
      "coverage",
      "certificates",
    ]);
    const drain = async (stream: ReadableStream<Uint8Array>) => {
      let pending = "";
      for await (const bytes of stream) {
        pending += new TextDecoder().decode(bytes);
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch {
            continue;
          }
          if (
            !value ||
            typeof value !== "object" ||
            !("validationProgress" in value) ||
            value.validationProgress !== true ||
            !("phase" in value) ||
            typeof value.phase !== "string" ||
            !knownPhases.has(value.phase) ||
            !("queryCount" in value) ||
            typeof value.queryCount !== "number" ||
            !Number.isSafeInteger(value.queryCount) ||
            !("elapsedMs" in value) ||
            typeof value.elapsedMs !== "number" ||
            !Number.isSafeInteger(value.elapsedMs)
          )
            continue;
          console.info(
            JSON.stringify({
              validationProgress: true,
              phase: value.phase,
              queryCount: value.queryCount,
              elapsedMs: value.elapsedMs,
            }),
          );
        }
      }
    };
    await Promise.all([drain(child.stdout), drain(child.stderr)]);
    if ((await child.exited) !== 0)
      throw new Error(
        "Protected stage failed; inspect durable receipts without blind repetition",
      );
    const data: unknown = await Bun.file(output).json();
    if (
      !data ||
      typeof data !== "object" ||
      !("result" in data) ||
      !data.result ||
      typeof data.result !== "object" ||
      !("mode" in data.result) ||
      !("planSha256" in data.result)
    )
      throw new Error("Stage summary unavailable");
    const result = data.result;
    const summary = {
      stage: env.VALIDATION_STAGE,
      mode: result.mode,
      reviewedPlanSha256: result.planSha256,
      sourceSha: env.GITHUB_SHA,
      project: "fvzxqlezdrlzykyoevub",
      operationId: env.VALIDATION_OPERATION_ID,
      anchorDay: env.VALIDATION_ANCHOR,
      notice:
        "Synthetic validation data; signed-current files have a non-institutional test notice. No Auth/provider reset, schema migration or business RESET occurs in this workflow.",
    };
    await Bun.write(
      join(env.RUNNER_TEMP, "full-validation-summary.json"),
      JSON.stringify(summary, null, 2),
    );
    console.info(JSON.stringify(summary));
  } catch {
    console.error(
      "Protected full validation stage stopped; credentials/private payload not printed.",
    );
    process.exitCode = 1;
  }
}
