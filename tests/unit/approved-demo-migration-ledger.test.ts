import { expect, test } from "bun:test";
import {
  assertApprovedDemoMigrationLedger,
  readApprovedDemoMigrations,
  type ApprovedDemoMigration,
  type DemoMigrationLedgerRow,
} from "../../scripts/approved-demo-migration-ledger";

const row = (id: number, migration: ApprovedDemoMigration) => ({
  id,
  hash: migration.hash,
  createdAt: String(migration.when),
});

test("approved demo accepts only the complete ordered source migration ledger", () => {
  const approved = readApprovedDemoMigrations();
  const actual = approved.map((migration, index) => row(index + 3, migration));

  expect(() =>
    assertApprovedDemoMigrationLedger(actual, approved),
  ).not.toThrow();
  expect(() =>
    assertApprovedDemoMigrationLedger(actual.slice(0, -1), approved),
  ).toThrow("current checkout migration ledger");

  for (const mutate of [
    (rows: DemoMigrationLedgerRow[]) => {
      rows[0]!.hash = "0".repeat(64);
    },
    (rows: DemoMigrationLedgerRow[]) => {
      rows[0]!.createdAt = String(approved[0]!.when + 1);
    },
    (rows: DemoMigrationLedgerRow[]) => {
      rows[1]!.id = rows[0]!.id;
    },
    (rows: DemoMigrationLedgerRow[]) => {
      [rows[0], rows[1]] = [rows[1]!, rows[0]!];
    },
  ]) {
    const changed = structuredClone(actual);
    mutate(changed);
    expect(() => assertApprovedDemoMigrationLedger(changed, approved)).toThrow(
      "current checkout migration ledger",
    );
  }
});

test("approved demo guard supports a future complete ledger without count-only approval", () => {
  const approved = Array.from({ length: 24 }, (_, index) => ({
    hash: index.toString(16).padStart(64, "0"),
    when: 1_791_500_766_703 + index,
  }));
  const actual = approved.map((migration, index) => row(index + 1, migration));

  expect(() =>
    assertApprovedDemoMigrationLedger(actual, approved),
  ).not.toThrow();
  expect(() =>
    assertApprovedDemoMigrationLedger(
      actual.map((entry, index) =>
        index === 23 ? { ...entry, hash: "c".repeat(64) } : entry,
      ),
      approved,
    ),
  ).toThrow("current checkout migration ledger");
});
