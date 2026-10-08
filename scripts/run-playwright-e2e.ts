export {};

const args = process.argv.slice(2);
const evidenceDir = process.env.E2E_EVIDENCE_DIR;

async function run(args: string[], env = process.env): Promise<number> {
  const child = Bun.spawn(
    [process.execPath, "x", "playwright", "test", ...args],
    {
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const stop = () => child.kill();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    return await child.exited;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (evidenceDir) {
  // List the complete configured cohort without starting Auth fixtures/server.
  // Actual execution below still uses Playwright's native file-based sharding.
  const listed = await run(
    ["--list", "--reporter=./scripts/e2e-evidence-reporter.ts"],
    { ...process.env, E2E_INVENTORY_ONLY: "1" },
  );
  if (listed !== 0) process.exit(listed);
}
process.exitCode = await run(args);
