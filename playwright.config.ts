import { defineConfig, devices } from "@playwright/test";

import { getTestSupabaseEnvironment } from "./scripts/supabase-local-env";

const localSupabase = getTestSupabaseEnvironment();

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/fixtures/setup-auth.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "**/private-mobile.spec.ts",
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: ["**/foundation.spec.ts", "**/private-mobile.spec.ts"],
    },
  ],
  webServer: {
    command: "bun scripts/e2e-server.ts",
    url: "http://127.0.0.1:4321",
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: localSupabase.databaseUrl,
      PUBLIC_SITE_URL: "http://127.0.0.1:4321",
      PUBLIC_SUPABASE_URL: localSupabase.apiUrl,
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: localSupabase.publishableKey,
    },
  },
});
