import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import {
  createDatabase,
  getDatabase,
  withRequestDatabase,
} from "@/server/db/client";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

const connectionString = getTestSupabaseEnvironment().databaseUrl;
const database = createDatabase(connectionString);

afterAll(async () => database.close());

describe("database connection", () => {
  test("isolates concurrent request connections and closes them after use", async () => {
    await expect(
      withRequestDatabase(
        async () => {
          const first = getDatabase();
          expect(getDatabase()).toBe(first);
          const nested = withRequestDatabase(
            async () => {
              const other = getDatabase();
              expect(other).not.toBe(first);
              await other.execute(sql`select 1`);
            },
            15_000,
            connectionString,
          );
          await first.execute(sql`select 1`);
          await nested;
        },
        15_000,
        connectionString,
      ),
    ).resolves.toBeUndefined();
    expect(() => getDatabase()).toThrow(
      "Database access requires a request scope",
    );
  });

  test("ends a stalled GET read before the serverless request deadline", async () => {
    const started = performance.now();
    await expect(
      withRequestDatabase(
        async () => getDatabase().execute(sql`select pg_sleep(3)`),
        50,
        connectionString,
      ),
    ).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(2_500);
  });
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
