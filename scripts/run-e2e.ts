import { assertE2ePortAvailable, runWithTestStack } from "./test-stack";
import { resolve } from "node:path";

const started = Date.now();
process.env.E2E_TEST_CLOCK_CONTROL = "1";
await assertE2ePortAvailable();
const exitCode = await runWithTestStack([
  process.execPath,
  "scripts/run-playwright-e2e.ts",
  ...process.argv.slice(2),
]);
if (process.env.E2E_EVIDENCE_DIR) {
  await Bun.write(
    resolve(process.env.E2E_EVIDENCE_DIR, "execution.json"),
    JSON.stringify({ exitCode, wallTimeMs: Date.now() - started }),
  );
}
process.exitCode = exitCode;
