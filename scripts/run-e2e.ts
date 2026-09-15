import { getLocalSupabaseEnvironment } from "./supabase-local-env";

const local = getLocalSupabaseEnvironment();
const child = Bun.spawn(
  [process.execPath, "x", "playwright", "test", ...process.argv.slice(2)],
  {
    env: {
      ...process.env,
      TEST_SUPABASE_URL: local.apiUrl,
      TEST_SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
      TEST_SUPABASE_SERVICE_ROLE_KEY: local.serviceRoleKey,
      TEST_DATABASE_URL: local.databaseUrl,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exit(await child.exited);
