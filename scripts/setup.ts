const bun = process.execPath;

if (Bun.version !== "1.4.2") {
  throw new Error(`Bun 1.4.2 is required, but ${Bun.version} is running.`);
}

if (!Bun.which("docker")) {
  throw new Error("Docker is required but was not found in PATH.");
}

const dockerCheck = Bun.spawnSync(["docker", "info"], {
  stdout: "ignore",
  stderr: "ignore",
});

if (dockerCheck.exitCode !== 0) {
  throw new Error("Docker is installed, but its daemon is not running.");
}

if (!(await Bun.file(".env").exists())) {
  await Bun.write(".env", Bun.file(".env.example"));
  console.info("Created .env from .env.example.");
}

const commands = [
  [bun, "run", "astro:sync"],
  [bun, "x", "playwright", "install", "chromium"],
  [bun, "run", "supabase:start"],
  [bun, "run", "db:reset"],
];

for (const command of commands) {
  const child = Bun.spawn(command, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`Setup command failed: ${command.join(" ")}`);
  }
}

export {};
