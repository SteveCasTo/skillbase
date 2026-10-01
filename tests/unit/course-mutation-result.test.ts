import { expect, test } from "bun:test";
import {
  isEditorialResult,
  isRevision,
  isUuid,
  isCourseSaveResult,
} from "@/domain/courses/mutation-result";

test("mutation DTOs require canonical identity, revision and intent-compatible state", () => {
  expect(isUuid(crypto.randomUUID())).toBe(true);
  expect(isUuid("draft")).toBe(false);
  for (const value of [
    true,
    "",
    "tomorrow",
    "2026-09-30",
    "2026-09-30T00:00:00Z",
  ])
    expect(isRevision(value)).toBe(false);
  const revision = "2026-09-30T00:00:00.000Z";
  expect(isRevision(revision)).toBe(true);
  expect(isCourseSaveResult({ revision })).toBe(false);
  expect(isCourseSaveResult({ revision, name: " " })).toBe(false);
  expect(isCourseSaveResult({ revision, name: "Curso" })).toBe(true);
  expect(
    isEditorialResult(
      { revision, status: "PUBLISHED", featured: false },
      "publish",
    ),
  ).toBe(true);
  expect(
    isEditorialResult(
      { revision, status: "DRAFT", featured: false },
      "publish",
    ),
  ).toBe(false);
  expect(
    isEditorialResult(
      { revision, status: "PUBLISHED", featured: false },
      "feature",
    ),
  ).toBe(false);
  expect(
    isEditorialResult(
      { revision, status: "ARCHIVED", featured: true },
      "archive",
    ),
  ).toBe(false);
  expect(
    isEditorialResult(
      { revision: true, status: "PUBLISHED", featured: true },
      "feature",
    ),
  ).toBe(false);
});
