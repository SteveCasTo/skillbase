export interface LocalSupabaseEnvironment {
  readonly apiUrl: string;
  readonly publishableKey: string;
  readonly serviceRoleKey: string;
  readonly databaseUrl: string;
}

export function getTestSupabaseEnvironment(): LocalSupabaseEnvironment {
  const apiUrl = process.env.TEST_SUPABASE_URL;
  const publishableKey = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const workdir = process.env.TEST_SUPABASE_WORKDIR;
  const projectId = process.env.TEST_SUPABASE_PROJECT_ID;
  if (
    !apiUrl ||
    !publishableKey ||
    !serviceRoleKey ||
    !databaseUrl ||
    !workdir ||
    !projectId
  )
    throw new Error(
      "An isolated test Supabase stack is required. Use bun run test:integration or test:e2e.",
    );
  if (!/^skillbase_test_[a-f0-9]{16}$/u.test(projectId))
    throw new Error("Invalid test project identity");
  const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  if (!config.includes(`project_id = "${projectId}"`))
    throw new Error("Test project identity does not match its configuration");
  const rootConfig = readFileSync(
    fileURLToPath(new URL("../supabase/config.toml", import.meta.url)),
    "utf8",
  );
  const workingId = rootConfig.match(/^project_id = "([^"]+)"/mu)?.[1];
  const workingApiPort = rootConfig.match(
    /^\[api\]\s*\n(?:[^\n]*\n)*?port = (\d+)/mu,
  )?.[1];
  const workingDbPort = rootConfig.match(
    /^\[db\]\s*\n(?:[^\n]*\n)*?port = (\d+)/mu,
  )?.[1];
  const api = new URL(apiUrl);
  const db = new URL(databaseUrl);
  if (
    !workingId ||
    !workingApiPort ||
    !workingDbPort ||
    projectId === workingId ||
    api.hostname !== "127.0.0.1" ||
    db.hostname !== "127.0.0.1" ||
    api.port === workingApiPort ||
    db.port === workingDbPort
  )
    throw new Error("Test stack is not isolated from the working local stack");
  const local = getLocalSupabaseEnvironment(workdir);
  if (
    api.origin !== new URL(local.apiUrl).origin ||
    databaseUrl !== local.databaseUrl ||
    publishableKey !== local.publishableKey ||
    serviceRoleKey !== local.serviceRoleKey
  )
    throw new Error("Test stack is not isolated from the working local stack");
  return local;
}

function parseEnvironment(output: string): Record<string, string> {
  return Object.fromEntries(
    output
      .split(/\r?\n/u)
      .map((line) => line.match(/^([A-Z_]+)="?([^"\r\n]+)"?$/u))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1]!, match[2]!]),
  );
}

export function getLocalSupabaseEnvironment(
  workdir?: string,
): LocalSupabaseEnvironment {
  const result = spawnSync(
    process.env.TEST_BUN_EXECUTABLE ?? process.execPath,
    [
      "x",
      "supabase",
      "status",
      "--output",
      "env",
      ...(workdir ? ["--workdir", workdir] : []),
    ],
    {
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID:
          process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID ??
          "local-test-placeholder",
        SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET:
          process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET ??
          "local-test-placeholder",
      },
    },
  );
  if (result.status !== 0)
    throw new Error("Supabase local must be running before auth tests");
  const values = parseEnvironment(result.stdout);
  const apiUrl = values.API_URL;
  const publishableKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
  const serviceRoleKey = values.SECRET_KEY ?? values.SERVICE_ROLE_KEY;
  const databaseUrl = values.DB_URL;
  if (!apiUrl || !publishableKey || !serviceRoleKey || !databaseUrl)
    throw new Error(
      "Supabase local status did not provide the required endpoints",
    );
  return { apiUrl, publishableKey, serviceRoleKey, databaseUrl };
}
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
