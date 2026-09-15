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
  if (!apiUrl || !publishableKey || !serviceRoleKey || !databaseUrl)
    throw new Error(
      "The E2E runner did not provide local Supabase configuration",
    );
  return { apiUrl, publishableKey, serviceRoleKey, databaseUrl };
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

export function getLocalSupabaseEnvironment(): LocalSupabaseEnvironment {
  const result = spawnSync(
    process.execPath,
    ["x", "supabase", "status", "--output", "env"],
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
