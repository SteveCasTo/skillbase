import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { createDatabase } from "@/server/db/client";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

const connectionString = getTestSupabaseEnvironment().databaseUrl;
const database = createDatabase(connectionString);

afterAll(async () => database.close());

describe("database connection", () => {
  test("executes a typed query against PostgreSQL", async () => {
    const result = await database.db.execute<{ value: number }>(
      sql`select 1::int as value`,
    );

    expect(result[0]?.value).toBe(1);
  });
});
