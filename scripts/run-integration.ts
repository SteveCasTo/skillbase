import { runWithTestStack } from "./test-stack";

process.exitCode = await runWithTestStack([
  process.execPath,
  "test",
  "tests/integration",
  ...process.argv.slice(2),
]);
