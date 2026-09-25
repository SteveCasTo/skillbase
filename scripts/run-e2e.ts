import { assertE2ePortAvailable, runWithTestStack } from "./test-stack";

await assertE2ePortAvailable();
process.exitCode = await runWithTestStack([
  process.execPath,
  "x",
  "playwright",
  "test",
  ...process.argv.slice(2),
]);
