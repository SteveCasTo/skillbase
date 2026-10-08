import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface WorkflowJob {
  "runs-on"?: string;
  if?: string;
  needs?: string[];
  steps?: {
    name?: string;
    run?: string;
    env?: Record<string, string>;
    "timeout-minutes"?: number;
    "continue-on-error"?: boolean;
  }[];
}

const workflow = Bun.YAML.parse(
  readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  ),
) as { jobs: Record<string, WorkflowJob> };
const aggregator = workflow.jobs["integration-e2e"]!;
const gate = aggregator.steps![0]!;
const bash =
  process.platform === "win32"
    ? join(
        process.env.ProgramFiles ?? "C:\\Program Files",
        "Git",
        "bin",
        "bash.exe",
      )
    : "bash";

function runGate(quality: string, integration: string, e2e: string): number {
  return Bun.spawnSync([bash, "-c", gate.run!], {
    env: {
      ...process.env,
      QUALITY_RESULT: quality,
      INTEGRATION_RESULT: integration,
      E2E_RESULT: e2e,
    },
  }).exitCode;
}

describe("required CI aggregate gate", () => {
  test("bounds browser provisioning without skipping required system dependencies", () => {
    const e2e = workflow.jobs.e2e!;
    expect(e2e["runs-on"]).toBe("ubuntu-24.04");
    const configure = e2e.steps!.findIndex(
      (step) => step.name === "Configure bounded Ubuntu dependency downloads",
    );
    const install = e2e.steps!.findIndex(
      (step) => step.run === "bunx playwright install --with-deps chromium",
    );
    const execute = e2e.steps!.findIndex((step) =>
      step.run?.startsWith("bun run test:e2e "),
    );
    expect(configure).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(configure);
    expect(execute).toBeGreaterThan(install);
    expect(e2e.steps![configure]!["timeout-minutes"]).toBe(1);
    expect(e2e.steps![install]!["timeout-minutes"]).toBe(5);
    expect(e2e.steps![configure]!["continue-on-error"]).not.toBe(true);
    expect(e2e.steps![install]!["continue-on-error"]).not.toBe(true);
    // Syntax-check the actual provisioning command; this is not a Linux/network install test.
    expect(
      Bun.spawnSync([bash, "-n", "-c", e2e.steps![configure]!.run!]).exitCode,
    ).toBe(0);
  });
  test("waits for all dependencies even when one is skipped or cancelled", () => {
    expect(aggregator.if).toBe("always()");
    expect(aggregator.needs).toEqual(["quality", "integration", "e2e"]);
    expect(gate.env).toEqual({
      QUALITY_RESULT: "${{ needs.quality.result }}",
      INTEGRATION_RESULT: "${{ needs.integration.result }}",
      E2E_RESULT: "${{ needs.e2e.result }}",
    });
  });

  test("only all-success passes the actual workflow shell command (64 combinations)", () => {
    const statuses = ["success", "failure", "cancelled", "skipped"];
    for (const quality of statuses)
      for (const integration of statuses)
        for (const e2e of statuses)
          expect({
            quality,
            integration,
            e2e,
            passed: runGate(quality, integration, e2e) === 0,
          }).toEqual({
            quality,
            integration,
            e2e,
            passed:
              quality === "success" &&
              integration === "success" &&
              e2e === "success",
          });
  });

  test("rejects missing or unknown dependency results", () => {
    for (const result of ["", "unknown"]) {
      expect(runGate(result, "success", "success")).not.toBe(0);
      expect(runGate("success", result, "success")).not.toBe(0);
      expect(runGate("success", "success", result)).not.toBe(0);
    }
  });

  test("retains the separately required quality and master-only deploy gates", () => {
    expect(workflow.jobs.quality).toBeDefined();
    expect(workflow.jobs.deploy!.needs).toEqual(["quality", "integration-e2e"]);
    expect(workflow.jobs.deploy!.if).toBe(
      "github.event_name == 'push' && github.ref == 'refs/heads/master' && needs.quality.result == 'success' && needs.integration-e2e.result == 'success'",
    );
  });
});
