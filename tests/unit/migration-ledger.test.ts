import { expect, test } from "bun:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  applicationMigrationsFolder,
  assertMigrationLedgerRows,
  expectedMigrationLedger,
} from "../fixtures/migration-ledger";

test("current migration expectations include every journal file's exact hash and timestamp", () => {
  const files = readMigrationFiles({
    migrationsFolder: applicationMigrationsFolder,
  });
  const expected = expectedMigrationLedger();
  expect(expected).toHaveLength(files.length);
  expect(expected).toEqual(
    files.map((file) => ({
      hash: file.hash,
      createdAt: String(file.folderMillis),
    })),
  );
  const rows = expected.map((row, index) => ({ ...row, id: 2 * index + 1 }));
  expect(() => assertMigrationLedgerRows(rows)).not.toThrow();
  expect(() => assertMigrationLedgerRows(rows.slice(0, -1))).toThrow();
  expect(() =>
    assertMigrationLedgerRows([
      ...rows,
      { ...rows.at(-1)!, id: rows.at(-1)!.id + 1 },
    ]),
  ).toThrow();
  expect(() =>
    assertMigrationLedgerRows(
      rows.map((row, index) =>
        index === 0 ? { ...row, hash: "0".repeat(64) } : row,
      ),
    ),
  ).toThrow();
  expect(() =>
    assertMigrationLedgerRows(
      rows.map((row, index) =>
        index === 0 ? { ...row, createdAt: "0" } : row,
      ),
    ),
  ).toThrow();
  expect(() =>
    assertMigrationLedgerRows(
      rows.map((row, index) =>
        index === 1 ? { ...row, id: rows[0]!.id } : row,
      ),
    ),
  ).toThrow();
});
