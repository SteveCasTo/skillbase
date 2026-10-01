import { getTestSupabaseEnvironment } from "./supabase-local-env";
import { e2ePort, e2eSiteUrl } from "./e2e-port";

const isolated = getTestSupabaseEnvironment();
process.env.DATABASE_URL = isolated.databaseUrl;
process.env.PUBLIC_SUPABASE_URL = isolated.apiUrl;
process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY = isolated.publishableKey;
process.env.SUPABASE_SERVICE_ROLE_KEY = isolated.serviceRoleKey;
process.env.PUBLIC_SITE_URL = e2eSiteUrl();

// Astro/Vite can snapshot public env at import time; inject test settings first.
const { dev } = await import("astro");
const server = await dev({
  // Vite must not load the developer's .env over the isolated test values.
  vite: { envDir: process.env.TEST_SUPABASE_WORKDIR! },
  // The dev-only overlay can intercept clicks on public course cards in E2E.
  devToolbar: { enabled: false },
  server: {
    host: "127.0.0.1",
    port: e2ePort(),
  },
});
if (server.address.port !== e2ePort()) {
  await server.stop();
  throw new Error(
    "E2E Astro did not bind its dedicated port; refusing to reuse another server.",
  );
}

async function close() {
  await server.stop();
  process.exit(0);
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
