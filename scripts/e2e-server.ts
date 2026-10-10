import { getTestSupabaseEnvironment } from "./supabase-local-env";
import { e2ePort, e2eSiteUrl } from "./e2e-port";
import type { Plugin } from "vite";

const nativeDate = Date;
let controlledNow: number | undefined;
globalThis.Date = new Proxy(nativeDate, {
  apply(target) {
    return new target(controlledNow ?? nativeDate.now()).toString();
  },
  construct(target, args, newTarget) {
    return Reflect.construct(
      target,
      args.length === 0 && controlledNow !== undefined ? [controlledNow] : args,
      newTarget,
    );
  },
  get(target, property, receiver) {
    if (property === "now") return () => controlledNow ?? nativeDate.now();
    return Reflect.get(target, property, receiver);
  },
}) as DateConstructor;

const e2eClockControl: Plugin = {
  name: "skillbase-e2e-clock-control",
  configureServer(viteServer) {
    viteServer.middlewares.use("/__e2e/clock", (request, response) => {
      if (request.method !== "POST") {
        response.statusCode = 405;
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/reset") {
        controlledNow = undefined;
        response.statusCode = 204;
        response.end();
        return;
      }
      const value = url.searchParams.get("now");
      const timestamp = value ? Date.parse(value) : Number.NaN;
      if (
        !Number.isFinite(timestamp) ||
        new Date(timestamp).toISOString() !== value
      ) {
        response.statusCode = 400;
        response.end();
        return;
      }
      controlledNow = timestamp;
      response.statusCode = 204;
      response.end();
    });
  },
};

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
  vite: {
    envDir: process.env.TEST_SUPABASE_WORKDIR!,
    plugins: [e2eClockControl],
  },
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
