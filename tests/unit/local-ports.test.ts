import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assertCanonicalLocalTarget } from "../../scripts/renew-demo-plan";

test("local configuration, examples and renewal guard share canonical endpoints", () => {
  const config = readFileSync("supabase/config.toml", "utf8");
  const example = readFileSync(".env.example", "utf8");
  const apiPort = config.match(/\[api\][\s\S]*?^port = (\d+)/mu)?.[1];
  const dbPort = config.match(/\[db\][\s\S]*?^port = (\d+)/mu)?.[1];
  const databaseUrl = example.match(/^DATABASE_URL=(.+)$/mu)?.[1];
  const migrationUrl = example.match(/^MIGRATION_DATABASE_URL=(.+)$/mu)?.[1];
  const apiUrl = example.match(/^PUBLIC_SUPABASE_URL=(.+)$/mu)?.[1];
  if (!apiPort || !dbPort || !databaseUrl || !migrationUrl || !apiUrl)
    throw new Error("Canonical local configuration is incomplete");
  expect(apiPort).toBe("55321");
  expect(dbPort).toBe("55322");
  expect(new URL(databaseUrl).port).toBe(dbPort);
  expect(migrationUrl).toBe(databaseUrl);
  expect(new URL(apiUrl).port).toBe(apiPort);
  expect(() => assertCanonicalLocalTarget(databaseUrl, apiUrl)).not.toThrow();
});
