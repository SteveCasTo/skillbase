import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

interface Step {
  name?: string;
  run?: string;
  if?: string;
  "continue-on-error"?: boolean;
}
interface Job {
  if?: string;
  needs?: string[];
  steps?: Step[];
  "continue-on-error"?: boolean;
}
const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const workflow = Bun.YAML.parse(read(".github/workflows/ci.yml")) as {
  jobs: Record<string, Job>;
};

test("required integration runs product, F8 and F9 exactly once in order, without optional or ignored steps", () => {
  const integration = workflow.jobs.integration!;
  const commands = [
    "bun run test:integration",
    "bun run test:integration:comprehensive-demo",
    "bun run test:integration:comprehensive-certificates",
  ];
  const integrationSteps = integration.steps!.filter((step) =>
    step.run?.startsWith("bun run test:integration"),
  );
  expect(integrationSteps.map((step) => step.run)).toEqual(commands);
  expect(integration.if).toBeUndefined();
  expect(integration["continue-on-error"]).toBeUndefined();
  for (const step of integrationSteps) {
    expect(step.if).toBeUndefined();
    expect(step["continue-on-error"]).toBeUndefined();
  }
  for (const command of commands) {
    const jobs = Object.entries(workflow.jobs).flatMap(([job, definition]) =>
      (definition.steps ?? [])
        .filter((step) => step.run === command)
        .map(() => job),
    );
    expect(jobs).toEqual(["integration"]);
  }
  const integrationRuns = integration
    .steps!.map((step) => step.run ?? "")
    .join("\n");
  expect(integrationRuns).not.toContain("--include-certificates");
  expect(integrationRuns).not.toContain("--allow-production");
  expect(integrationRuns).not.toContain("scripts/comprehensive-demo.ts");
  expect(workflow.jobs["integration-e2e"]!.needs).toContain("integration");
  expect(
    workflow.jobs["integration-e2e"]!.steps!.some((step) =>
      step.run?.includes('test "$INTEGRATION_RESULT" = success'),
    ),
  ).toBe(true);
  expect(workflow.jobs.deploy!.needs).toContain("integration-e2e");
  expect(workflow.jobs.deploy!.if).toContain(
    "needs.integration-e2e.result == 'success'",
  );
});

test("CI maps the demo command to the scoped managed runner, never the seed CLI or shared inventory", () => {
  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
  };
  for (const suite of ["comprehensive-demo", "comprehensive-certificates"]) {
    expect(pkg.scripts[`test:integration:${suite}`]).toBe(
      `bun scripts/test-${suite}.ts`,
    );
    const runner = read(`scripts/test-${suite}.ts`);
    expect(runner).toContain('import { runWithTestStack } from "./test-stack"');
    expect(runner).toContain(`"tests/${suite}"`);
    expect(runner).toContain("requireCleanup: true");
    expect(runner).toContain("process.exitCode = await runWithTestStack(");
    expect(runner).not.toContain("comprehensive-demo.ts");
    expect(runner).not.toContain("--allow-production");
    expect(runner).not.toContain("--include-certificates");
  }
  expect(read("scripts/run-integration.ts")).toContain('"tests/integration"');
});
