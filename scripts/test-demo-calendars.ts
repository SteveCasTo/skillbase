import { runWithTestStack } from "./test-stack";
process.exitCode = await runWithTestStack([
  process.execPath,
  "test",
  "tests/demo-calendars/demo-calendars.integration.test.ts",
]);
