import { runWithTestStack } from "./test-stack";

process.exitCode = await runWithTestStack([
  process.execPath,
  "test",
  "tests/integration/renew-demo.test.ts",
]);
