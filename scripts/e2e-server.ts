import { getTestSupabaseEnvironment } from "./supabase-local-env";

const isolated = getTestSupabaseEnvironment();
process.env.DATABASE_URL = isolated.databaseUrl;
process.env.PUBLIC_SUPABASE_URL = isolated.apiUrl;
process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY = isolated.publishableKey;
process.env.SUPABASE_SERVICE_ROLE_KEY = isolated.serviceRoleKey;
process.env.PUBLIC_SITE_URL = "http://127.0.0.1:4321";

// Astro/Vite can snapshot public env at import time; inject test settings first.
const { dev } = await import("astro");
const server = await dev({
  // Vite must not load the developer's .env over the isolated test values.
  vite: { envDir: process.env.TEST_SUPABASE_WORKDIR! },
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
});
if (server.address.port !== 4321) {
  await server.stop();
  throw new Error(
    "E2E Astro did not bind port 4321; refusing to reuse another server.",
  );
}

async function close() {
  await server.stop();
  process.exit(0);
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
