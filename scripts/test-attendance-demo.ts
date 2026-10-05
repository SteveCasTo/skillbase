import { runWithTestStack } from "./test-stack";

process.exitCode = await runWithTestStack([
  process.execPath,
  "test",
  "tests/attendance-demo/attendance-demo.integration.test.ts",
]);
