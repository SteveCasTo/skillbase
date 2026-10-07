import { expect, test } from "bun:test";
import { privateClosureReport } from "@/server/academic-closure/projection";
import type { ClosureReportDto } from "@/domain/academic-closure/types";
import { closureJson } from "@/server/academic-closure/http";

function report(): ClosureReportDto {
  const mark = {
    status: "PRESENT" as const,
    inferred: false,
    markedBy: "actor",
    markedByName: "Synthetic Actor",
    markedAt: "2026-10-01T12:00:00Z",
  };
  return {
    courseId: "course",
    courseName: "Course",
    groupId: "group",
    groupName: "Group",
    instructorId: "instructor",
    instructorName: "Instructor",
    minimumGrade: 70,
    scheme: {
      revision: 2,
      frozenAt: "2026-10-01T12:00:00Z",
      modality: "THEORY",
      canEdit: false,
      components: [
        {
          id: "component",
          name: "Evaluation",
          type: "THEORY",
          weight: "100",
          order: 0,
        },
      ],
    },
    attendanceSettings: {
      revision: 1,
      consecutiveAbsenceLimit: 3,
      updatedAt: "2026-10-01T12:00:00Z",
    },
    participants: [
      {
        participantId: "participant",
        registrationId: "registration",
        groupId: "group",
        firstName: "Synthetic",
        lastName: "Student",
        membershipStatus: "INSCRITO",
        canGrade: false,
        ci: "PRIVATE-CI-ONLY",
        balanceCents: 98765,
        grades: [
          {
            componentId: "component",
            score: "80.00",
            revision: 1,
            recordedBy: "actor",
            recordedByName: "Synthetic Actor",
            recordedAt: mark.markedAt,
          },
        ],
        result: {
          status: "COMPLETE",
          finalGrade: "80.00",
          decisionGrade: "80.00",
          passed: true,
          missingComponentIds: [],
        },
        attendance: {
          present: 1,
          absent: 0,
          excused: 0,
          pending: 0,
          consecutiveAbsences: 0,
          maximumConsecutiveAbsences: 0,
          warning: false,
          academicallyEligible: true,
        },
        academicallyPassed: true,
      },
    ],
    sessions: [
      {
        id: "session",
        startsAt: mark.markedAt,
        endsAt: "2026-10-01T13:30:00Z",
        cancelledAt: null,
        cancellationReason: null,
        replacementForSessionId: null,
        administrativeReviewRequired: false,
        revision: 1,
        instructorAttendance: mark,
        participants: [
          {
            registrationId: "registration",
            firstName: "Synthetic",
            lastName: "Student",
            attendance: mark,
          },
        ],
      },
    ],
  };
}
function assertInstructorPrivacy(value: unknown): void {
  const forbidden = new Set([
    "ci",
    "email",
    "phone",
    "balanceCents",
    "participantType",
    "minimumPaymentCents",
    "totalPriceCents",
    "ledger",
  ]);
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertInstructorPrivacy(item);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    expect(forbidden.has(key)).toBe(false);
    assertInstructorPrivacy(item);
  }
}
test("academic closure instructor projection recursively excludes private identity and future financial/contact fields without changing snapshots", async () => {
  const stored = report();
  const privateFields = {
    email: "future-private@test.invalid",
    phone: "PRIVATE-PHONE",
    participantType: "STUDENT",
    ledger: [{ totalPriceCents: 123456 }],
    minimumPaymentCents: 54321,
  };
  const future = {
    ...stored,
    ...privateFields,
    scheme: {
      ...stored.scheme,
      ...privateFields,
      components: stored.scheme.components.map((c) => ({
        ...c,
        ...privateFields,
      })),
    },
    attendanceSettings: { ...stored.attendanceSettings, ...privateFields },
    participants: stored.participants.map((p) => ({
      ...p,
      ...privateFields,
      grades: p.grades.map((g) => ({ ...g, ...privateFields })),
      result: { ...p.result, ...privateFields },
      attendance: { ...p.attendance, ...privateFields },
    })),
    sessions: stored.sessions.map((s) => ({
      ...s,
      ...privateFields,
      instructorAttendance: { ...s.instructorAttendance, ...privateFields },
      participants: s.participants.map((p) => ({
        ...p,
        ...privateFields,
        attendance: { ...p.attendance, ...privateFields },
      })),
    })),
  };
  const original = JSON.stringify(future);
  const instructor = privateClosureReport(future, false);
  expect(instructor.access).toBe("INSTRUCTOR");
  assertInstructorPrivacy(instructor);
  const json = await closureJson({ ok: true, value: instructor }).text();
  for (const secret of [
    "PRIVATE-CI-ONLY",
    "future-private@test.invalid",
    "PRIVATE-PHONE",
    "98765",
    "54321",
    "123456",
  ])
    expect(json).not.toContain(secret);
  expect(instructor.participants[0]).toMatchObject({
    registrationId: "registration",
    firstName: "Synthetic",
    grades: [{ score: "80.00", recordedBy: null }],
    result: { passed: true },
    attendance: { academicallyEligible: true },
  });
  expect(instructor.sessions[0]!.participants[0]!.attendance.markedBy).toBe(
    "actor",
  );
  expect(JSON.stringify(future)).toBe(original);
  const admin = privateClosureReport(future, true);
  if (admin.access !== "ADMIN") throw new Error("Expected admin projection");
  expect(admin.participants[0]!.ci).toBe("PRIVATE-CI-ONLY");
  expect(admin.participants[0]!.balanceCents).toBe(98765);
  expect(JSON.stringify(admin)).toContain("future-private@test.invalid");
});
