import { expect, test } from "bun:test";
import { assertDemoResetHasNoFinancialHistory } from "../../scripts/renew-demo";
import { RESET_TABLES } from "../../scripts/renew-demo-plan";

test("demo reset permits absent history, refuses protected history with actionable recovery", () => {
  expect(() => assertDemoResetHasNoFinancialHistory(false)).not.toThrow();
  expect(() => assertDemoResetHasNoFinancialHistory(true)).toThrow(
    "Use insert-only renewal",
  );
  expect(() => assertDemoResetHasNoFinancialHistory(true)).toThrow(
    "preserve all participant, registration and cash history",
  );
});
test("demo reset allowlist excludes financial history, identities and global configuration", () => {
  expect(RESET_TABLES).toHaveLength(8);
  for (const table of [
    "participants",
    "pre_registrations",
    "registration_ledger",
    "registration_command_receipts",
    "registration_settings",
    "users",
    "user_roles",
    "instructor_profiles",
  ])
    expect(RESET_TABLES as readonly string[]).not.toContain(table);
});
