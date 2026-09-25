import { dev } from "astro";

import { getLocalSupabaseEnvironment } from "./supabase-local-env";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required in .env before starting Astro.");
}

// Bun loads .env for this entrypoint. Starting `astro dev` directly through a
// package script leaves DATABASE_URL out of process.env in its Node process.
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
if (supabaseUrl && new URL(supabaseUrl).hostname === "127.0.0.1") {
  const local = getLocalSupabaseEnvironment();
  if (new URL(supabaseUrl).origin !== new URL(local.apiUrl).origin) {
    throw new Error(
      "PUBLIC_SUPABASE_URL does not match the local Supabase stack.",
    );
  }
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= local.serviceRoleKey;
}

const server = await dev({
  server: { host: "127.0.0.1", port: 4321 },
});

async function close() {
  await server.stop();
  process.exit(0);
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
