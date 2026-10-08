import { runWithTestStack } from "./test-stack";

process.exitCode = await runWithTestStack([
  process.execPath,
  "test",
  "tests/comprehensive-demo",
  "--timeout",
  "120000",
]);
