import { resolve } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";

export interface DemoMigrationLedgerRow extends Record<string, unknown> {
  id: number;
  hash: string;
  createdAt: string;
}

export interface ApprovedDemoMigration {
  hash: string;
  when: number;
}

/** Read the approved source checkout's Drizzle journal and exact SQL files. */
export function readApprovedDemoMigrations(): ApprovedDemoMigration[] {
  return readMigrationFiles({
    migrationsFolder: resolve(import.meta.dir, "../drizzle"),
  }).map(({ hash, folderMillis }) => ({ hash, when: folderMillis }));
}

/**
 * Require a complete, ordered match to this checkout's approved migrations.
 * Ledger IDs are database identities (and may have gaps), not journal indices.
 */
export function assertApprovedDemoMigrationLedger(
  rows: readonly DemoMigrationLedgerRow[],
  approved: readonly ApprovedDemoMigration[] = readApprovedDemoMigrations(),
): void {
  if (
    approved.length === 0 ||
    rows.length !== approved.length ||
    rows.some(
      (row, index) =>
        !Number.isSafeInteger(row.id) ||
        row.id <= 0 ||
        (index > 0 && row.id <= rows[index - 1]!.id) ||
        row.hash !== approved[index]!.hash ||
        row.createdAt !== String(approved[index]!.when),
    )
  )
    throw new Error(
      "Approved demo requires the current checkout migration ledger; no migration performed",
    );
}
