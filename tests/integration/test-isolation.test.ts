import { describe, expect, test } from "bun:test";

import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

describe("test stack isolation", () => {
  test("rejects working local endpoints even when test credentials are present", () => {
    const isolated = getTestSupabaseEnvironment();
    const originalApi = process.env.TEST_SUPABASE_URL;
    const originalDb = process.env.TEST_DATABASE_URL;
    try {
      process.env.TEST_SUPABASE_URL = "http://127.0.0.1:54321";
      expect(() => getTestSupabaseEnvironment()).toThrow("not isolated");
      process.env.TEST_SUPABASE_URL = originalApi;
      process.env.TEST_DATABASE_URL =
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
      expect(() => getTestSupabaseEnvironment()).toThrow("not isolated");
      process.env.TEST_DATABASE_URL = originalDb;
      expect(getTestSupabaseEnvironment()).toEqual(isolated);
    } finally {
      process.env.TEST_SUPABASE_URL = originalApi;
      process.env.TEST_DATABASE_URL = originalDb;
    }
  }, 20_000);
});
