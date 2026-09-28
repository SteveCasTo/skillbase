import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { createDatabase } from "@/server/db/client";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

const connectionString = getTestSupabaseEnvironment().databaseUrl;
const database = createDatabase(connectionString);

afterAll(async () => database.close());

describe("database connection", () => {
  test("executes a typed query against PostgreSQL", async () => {
    await database.probe();
    const result = await database.db.execute<{ value: number }>(
      sql`select 1::int as value`,
    );

    expect(result[0]?.value).toBe(1);
  });

  test("serializes concurrent reads without transaction-pooler pipelining", async () => {
    const serial = createDatabase(connectionString, { max: 1, maxPipeline: 1 });
    try {
      await serial.probe();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          serial.db.execute<{ value: number }>(sql`select 1::int as value`),
        ),
      );
      expect(results.map((rows) => rows[0]?.value)).toEqual([1, 1, 1, 1, 1]);
      const transaction = await serial.db.transaction(async (tx) =>
        tx.execute<{ value: number }>(sql`select 2::int as value`),
      );
      expect(transaction[0]?.value).toBe(2);
    } finally {
      await serial.close();
    }
  });
});
