import { createHash } from "node:crypto";

/** Operator-only inventory. This module cannot reset, migrate, seed or upload. */
export const FULL_VALIDATION_BUSINESS_TABLES = [
  "academic_closure_receipts",
  "academic_closure_versions",
  "academic_group_reopenings",
  "academic_group_states",
  "attendance_command_receipts",
  "audit_events",
  "certificate_artifacts",
  "certificate_events",
  "certificate_receipts",
  "certificates",
  "course_instructor_history",
  "course_type_revisions",
  "course_types",
  "courses",
  "evaluation_command_receipts",
  "evaluation_components",
  "evaluation_grades",
  "evaluation_results",
  "evaluation_schemes",
  "group_sessions",
  "groups",
  "instructor_attendance",
  "interest_registrations",
  "participant_attendance",
  "participants",
  "pre_registrations",
  "registration_command_receipts",
  "registration_ledger",
  "session_roster",
] as const;

export const FULL_VALIDATION_RETAINED_TABLES = [
  "admin_account_deletions",
  "attendance_settings",
  "auth_attempt_buckets",
  "auth_google_link_requests",
  "certificate_settings",
  "instructor_account_deletions",
  "instructor_profiles",
  "interest_registration_rate_limits",
  "registration_settings",
  "roles",
  "user_roles",
  "users",
] as const;

function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function fullValidationPlanHash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function assertReviewedStorageObject(
  expected: {
    id: string;
    bucket: string;
    name: string;
    metadata?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  },
  actual: {
    id: string;
    bucket: string;
    name: string;
    metadata?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  },
): void {
  if (fullValidationPlanHash(expected) !== fullValidationPlanHash(actual))
    throw new Error(
      "Reviewed Storage object metadata/content descriptor changed; no deletion",
    );
}
