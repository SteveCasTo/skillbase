import { runWithTestStack } from "./test-stack";

process.exitCode = await runWithTestStack([
  process.execPath,
  "test",
  "tests/financial-demo/financial-demo.integration.test.ts",
]);
