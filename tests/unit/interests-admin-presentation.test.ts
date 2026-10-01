import { describe, expect, test } from "bun:test";
import {
  isAdminMetrics,
  isAdminRegistration,
  visibleAfterMutation,
} from "@/components/interests/admin-presentation";

const courseId = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000001";
const groupId = "30000000-0000-4000-8000-000000000001";
const registration = {
  id,
  courseId,
  firstName: "Persona",
  lastName: "Sintética",
  email: "interest@example.test",
  phone: null,
  preferredGroupId: null,
  status: "ACTIVE",
  createdAt: "2026-09-30T10:00:00.000Z",
  updatedAt: "2026-09-30T10:00:00.001Z",
};

describe("admin interest presentation reconciliation", () => {
  test("accepts serializable current row and rejects another entity/course or malformed revision", () => {
    expect(isAdminRegistration(registration, courseId, id)).toBe(true);
    expect(
      isAdminRegistration(
        {
          ...registration,
          status: "CANCELLED",
          preferredGroupId: groupId,
          phone: "+591 70000000",
        },
        courseId,
        id,
      ),
    ).toBe(true);
    for (const value of [
      null,
      [],
      { ...registration, id: groupId },
      { ...registration, courseId: groupId },
      { ...registration, status: "PLANNED" },
      { ...registration, updatedAt: new Date() },
      { ...registration, updatedAt: "2026-02-30T10:00:00.000Z" },
      { ...registration, phone: 123 },
    ]) {
      expect(isAdminRegistration(value, courseId, id)).toBe(false);
    }
  });

  test("accepts consistent metrics including zero historical preference and rejects incomplete totals", () => {
    const metrics = {
      courseId,
      activeTotal: 2,
      byPreference: [
        { preferredGroupId: null, activeCount: 2 },
        { preferredGroupId: groupId, activeCount: 0 },
      ],
    };
    expect(isAdminMetrics(metrics, courseId)).toBe(true);
    for (const value of [
      { ...metrics, activeTotal: 3 },
      { ...metrics, courseId: groupId },
      { ...metrics, activeTotal: -1 },
      { ...metrics, byPreference: [] },
      {
        ...metrics,
        byPreference: [{ preferredGroupId: null, activeCount: 1.5 }],
      },
      {
        ...metrics,
        byPreference: [{ preferredGroupId: groupId, activeCount: 2 }],
      },
      {
        ...metrics,
        byPreference: [...metrics.byPreference, metrics.byPreference[0]],
      },
    ]) {
      expect(isAdminMetrics(value, courseId)).toBe(false);
    }
  });

  test("retains all-status rows and excludes a changed row from the selected status", () => {
    expect(visibleAfterMutation("", "ACTIVE")).toBe(true);
    expect(visibleAfterMutation("", "CANCELLED")).toBe(true);
    expect(visibleAfterMutation("ACTIVE", "CANCELLED")).toBe(false);
    expect(visibleAfterMutation("CANCELLED", "ACTIVE")).toBe(false);
    expect(visibleAfterMutation("ACTIVE", "ACTIVE")).toBe(true);
  });
});
