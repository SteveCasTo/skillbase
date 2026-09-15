const bun = process.execPath;
const localEnvironment = {
  ...process.env,
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  MIGRATION_DATABASE_URL:
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
};

const commands = [
  [bun, "x", "supabase", "db", "reset", "--local", "--yes"],
  [bun, "x", "drizzle-kit", "migrate"],
  [bun, "run", "db:seed"],
];

for (const command of commands) {
  const child = Bun.spawn(command, {
    env: localEnvironment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  if ((await child.exited) !== 0) {
    throw new Error(
      `Database reset failed while running: ${command.join(" ")}`,
    );
  }
}

export {};
