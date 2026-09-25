import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getLocalSupabaseEnvironment,
  getTestSupabaseEnvironment,
} from "./supabase-local-env";

const root = join(import.meta.dir, "..");
const exclude =
  "realtime,imgproxy,studio,mailpit,edge-runtime,logflare,vector,supavisor,postgres-meta";

function cli(args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, ["x", "supabase", ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 300_000,
  });
  if (result.status !== 0)
    throw new Error(
      `Supabase ${args[0]} failed (exit ${result.status ?? "timeout"}); CLI output withheld to avoid leaking local keys. Check Docker and the isolated stack configuration.`,
    );
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("No port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

export async function assertE2ePortAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          "E2E requires free port 127.0.0.1:4321; stop the existing Astro server yourself before running tests.",
        ),
      ),
    );
    server.listen(4321, "127.0.0.1", () => server.close(() => resolve()));
  });
}

export async function runWithTestStack(command: string[]): Promise<number> {
  const workdir = mkdtempSync(join(tmpdir(), "skillbase-test-"));
  const projectId = `skillbase_test_${randomBytes(8).toString("hex")}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: "local-test-placeholder",
    SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET: "local-test-placeholder",
  };
  // Bun loads .env in the entrypoint. Never let its database or OAuth settings
  // become migration/test targets or test-stack credentials.
  for (const key of [
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "PUBLIC_SUPABASE_URL",
    "PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TEST_DATABASE_URL",
    "TEST_SUPABASE_URL",
    "TEST_SUPABASE_PUBLISHABLE_KEY",
    "TEST_SUPABASE_SERVICE_ROLE_KEY",
    "TEST_SUPABASE_WORKDIR",
    "TEST_SUPABASE_PROJECT_ID",
  ])
    delete env[key];
  let started = false;
  try {
    const ports = new Set<number>();
    while (ports.size < 9) {
      const port = await freePort();
      if (port !== 4321 && (port < 54320 || port > 54329)) ports.add(port);
    }
    const [api, db, shadow, pooler, studio, smtp, analytics, inspector, edge] =
      [...ports];
    const original = readFileSync(
      join(root, "supabase", "config.toml"),
      "utf8",
    );
    const portFor: Record<string, number> = {
      "[api]": api!,
      "[db]": db!,
      "[db.pooler]": pooler!,
      "[studio]": studio!,
      "[local_smtp]": smtp!,
      "[analytics]": analytics!,
      "[edge_runtime]": edge!,
    };
    let section = "";
    const config = original.replace(/^.*$/gmu, (line) => {
      if (/^\[[^\]]+\]$/u.test(line)) section = line;
      if (/^project_id = /u.test(line)) return `project_id = "${projectId}"`;
      if (section === "[db]" && /^shadow_port = /u.test(line))
        return `shadow_port = ${shadow}`;
      if (section === "[edge_runtime]" && /^inspector_port = /u.test(line))
        return `inspector_port = ${inspector}`;
      if (portFor[section] && /^port = /u.test(line))
        return `port = ${portFor[section]}`;
      return line;
    });
    mkdirSync(join(workdir, "supabase"));
    writeFileSync(join(workdir, "supabase", "config.toml"), config);
    // No migrations, seed, .env or Docker state are copied from the working project.
    started = true; // start can partially create containers before failing
    cli(["start", "--workdir", workdir, "--exclude", exclude], env);
    const local = getLocalSupabaseEnvironment(workdir);
    Object.assign(env, {
      TEST_BUN_EXECUTABLE: process.execPath,
      TEST_SUPABASE_WORKDIR: workdir,
      TEST_SUPABASE_PROJECT_ID: projectId,
      TEST_SUPABASE_URL: local.apiUrl,
      TEST_SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
      TEST_SUPABASE_SERVICE_ROLE_KEY: local.serviceRoleKey,
      TEST_DATABASE_URL: local.databaseUrl,
      DATABASE_URL: local.databaseUrl,
      MIGRATION_DATABASE_URL: local.databaseUrl,
    });
    // Check the CLI-reported ports and keys against the dedicated config before migrate.
    const saved = process.env;
    try {
      process.env = env;
      getTestSupabaseEnvironment();
    } finally {
      process.env = saved;
    }
    const migration = spawnSync(
      process.execPath,
      ["x", "drizzle-kit", "migrate"],
      {
        cwd: root,
        env,
        stdio: "inherit",
        timeout: 300_000,
      },
    );
    if (migration.status !== 0)
      throw new Error("Isolated Drizzle migration failed");
    const child = Bun.spawn(command, {
      cwd: root,
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const signal = () => child.kill();
    process.once("SIGINT", signal);
    process.once("SIGTERM", signal);
    try {
      return await child.exited;
    } finally {
      process.off("SIGINT", signal);
      process.off("SIGTERM", signal);
    }
  } finally {
    let stopped = !started;
    if (started) {
      try {
        cli(
          [
            "stop",
            "--workdir",
            workdir,
            "--project-id",
            projectId,
            "--no-backup",
          ],
          env,
        );
        stopped = true;
      } catch (error) {
        console.error(
          "Dedicated test stack cleanup failed; inspect Docker project",
          projectId,
          workdir,
          error,
        );
      }
    }
    if (stopped) rmSync(workdir, { recursive: true, force: true });
  }
}
