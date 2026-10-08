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

test("one required integration job runs product once and owned demo once, without an ignored extra job", () => {
  const integration = workflow.jobs.integration!;
  const product = integration.steps!.filter(
    (step) => step.run === "bun run test:integration",
  );
  const demo = integration.steps!.filter(
    (step) => step.run === "bun run test:integration:comprehensive-demo",
  );
  expect(product).toHaveLength(1);
  expect(demo).toHaveLength(1);
  expect(integration.steps!.indexOf(demo[0]!)).toBeGreaterThan(
    integration.steps!.indexOf(product[0]!),
  );
  expect(integration.if).toBeUndefined();
  expect(integration["continue-on-error"]).not.toBe(true);
  for (const step of [...product, ...demo]) {
    expect(step.if).toBeUndefined();
    expect(step["continue-on-error"]).not.toBe(true);
  }
  const demoSteps = Object.entries(workflow.jobs).flatMap(([job, definition]) =>
    (definition.steps ?? [])
      .filter((step) =>
        step.run?.includes("test:integration:comprehensive-demo"),
      )
      .map(() => job),
  );
  expect(demoSteps).toEqual(["integration"]);
  expect(workflow.jobs["integration-e2e"]!.needs).toContain("integration");
  expect(workflow.jobs.deploy!.needs).toContain("integration-e2e");
});

test("CI maps the demo command to the scoped managed runner, never the seed CLI or shared inventory", () => {
  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
  };
  expect(pkg.scripts["test:integration:comprehensive-demo"]).toBe(
    "bun scripts/test-comprehensive-demo.ts",
  );
  const runner = read("scripts/test-comprehensive-demo.ts");
  expect(runner).toContain('import { runWithTestStack } from "./test-stack"');
  expect(runner).toContain('"tests/comprehensive-demo"');
  expect(runner).toContain("requireCleanup: true");
  expect(runner).not.toContain("comprehensive-demo.ts");
  expect(runner).not.toContain("--allow-production");
  expect(read("scripts/run-integration.ts")).toContain('"tests/integration"');
});
