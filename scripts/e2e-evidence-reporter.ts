import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
} from "@playwright/test/reporter";

export default class EvidenceReporter implements Reporter {
  private suite?: Suite;
  private config?: FullConfig;

  onBegin(config: FullConfig, suite: Suite): void {
    this.suite = suite;
    this.config = config;
  }

  onEnd(result: FullResult): void {
    const directory = process.env.E2E_EVIDENCE_DIR;
    if (!directory || !this.suite)
      throw new Error("Missing E2E evidence context");
    const inventoryOnly = process.env.E2E_INVENTORY_ONLY === "1";
    const cases = this.suite.allTests().map((test) => ({
      // Project + source + complete title + line distinguish desktop/mobile cases.
      id: JSON.stringify([
        test.parent.project()!.name,
        relative(process.cwd(), test.location.file).replaceAll("\\", "/"),
        test.titlePath().slice(2),
        test.location.line,
      ]),
      outcome: test.outcome(),
      attempts: test.results.map((attempt) => ({
        status: attempt.status,
        retry: attempt.retry,
        durationMs: attempt.duration,
      })),
    }));
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      resolve(directory, inventoryOnly ? "inventory.json" : "outcomes.json"),
      JSON.stringify(
        {
          status: result.status,
          durationMs: result.duration,
          isolation: {
            projectId: process.env.TEST_SUPABASE_PROJECT_ID,
            apiPort: new URL(process.env.TEST_SUPABASE_URL!).port,
            databasePort: new URL(process.env.TEST_DATABASE_URL!).port,
            serverPort: process.env.E2E_SERVER_PORT ?? "4321",
            workers: this.config?.workers,
            fullyParallel: this.config?.fullyParallel,
            shard: this.config?.shard,
          },
          cases,
        },
        null,
        2,
      ),
    );
  }
}
