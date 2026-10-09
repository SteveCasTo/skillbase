import { runWithTestStack } from "./test-stack";

process.exitCode = await runWithTestStack(
  [
    process.execPath,
    "test",
    "tests/comprehensive-certificates",
    "--timeout",
    "120000",
  ],
  { requireCleanup: true },
);
