import { expect } from "bun:test";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { AttendanceDatabase } from "@/server/db/repositories/attendance-calendar";

export const applicationMigrationsFolder = resolve(
  import.meta.dir,
  "../../drizzle",
);
export type MigrationLedgerRow = {
  id: number;
  hash: string;
  createdAt: string;
};

/** Read the active journal and hash each exact migration file through Drizzle's
 * own reader. This is the current checkout, not a hardcoded historical phase. */
export function expectedMigrationLedger() {
  return readMigrationFiles({
    migrationsFolder: applicationMigrationsFolder,
  }).map((migration) => ({
    hash: migration.hash,
    createdAt: String(migration.folderMillis),
  }));
}
export async function readMigrationLedger(
  db: Pick<AttendanceDatabase, "execute">,
): Promise<MigrationLedgerRow[]> {
  const rows = await db.execute<MigrationLedgerRow>(
    sql`select id, hash, created_at::text as "createdAt" from drizzle.__drizzle_migrations order by created_at, id`,
  );
  return Array.from(rows);
}
export function assertMigrationLedgerRows(rows: readonly MigrationLedgerRow[]) {
  const expected = expectedMigrationLedger();
  expect(
    rows.map((row) => ({ hash: row.hash, createdAt: row.createdAt })),
  ).toEqual(expected);
  // IDs are database evidence, not journal indices: allow sequence gaps after
  // rolled-back attempts but require positive, unique and monotonic identities.
  expect(
    rows.every(
      (row, index) =>
        Number.isSafeInteger(row.id) &&
        row.id > 0 &&
        (index === 0 || row.id > rows[index - 1]!.id),
    ),
  ).toBe(true);
}
export async function assertCurrentMigrationLedger(
  db: Pick<AttendanceDatabase, "execute">,
) {
  const rows = await readMigrationLedger(db);
  assertMigrationLedgerRows(rows);
  return rows;
}
