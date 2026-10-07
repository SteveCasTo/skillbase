import { expect, test } from "bun:test";
import {
  closureBlockers,
  validateReopen,
} from "@/domain/academic-closure/rules";
import type { ClosureReportDto } from "@/domain/academic-closure/types";
import type { InternalUser } from "@/domain/auth/types";
import type { ClosureRepository } from "@/application/academic-closure/closure-repository";
import { requireClosureActor } from "@/application/academic-closure/manage-closure";
import {
  handleClosurePost,
  closureJson,
  closureFailure,
} from "@/server/academic-closure/http";
import { loadAcademicClosure } from "@/server/academic-closure/loaders";
import { ClosureError } from "@/domain/academic-closure/rules";

const id = "11111111-1111-4111-8111-111111111111";
const actor: InternalUser = {
  id,
  email: "synthetic@test.invalid",
  name: "Synthetic",
  status: "ACTIVE",
  roles: ["ADMIN"],
  authUserId: id,
  authPrimaryProvider: "EMAIL",
};
function report(): ClosureReportDto {
  return {
    courseId: id,
    courseName: "Synthetic",
    groupId: id,
    groupName: "A",
    instructorId: id,
    instructorName: "Synthetic Instructor",
    minimumGrade: 70,
    scheme: {
      revision: 2,
      frozenAt: "2026-10-01T00:00:00Z",
      modality: "THEORY",
      canEdit: false,
      components: [
        { id, name: "Libre", type: "THEORY", weight: "100", order: 0 },
      ],
    },
    attendanceSettings: {
      revision: 1,
      consecutiveAbsenceLimit: 1,
      updatedAt: "2026-10-01T00:00:00Z",
    },
    participants: [
      {
        participantId: id,
        registrationId: id,
        groupId: id,
        firstName: "Synthetic",
        lastName: "Student",
        ci: "QA",
        balanceCents: 5000,
        membershipStatus: "INSCRITO",
        canGrade: false,
        grades: [],
        result: {
          status: "COMPLETE",
          finalGrade: "70.00",
          decisionGrade: "70.00",
          passed: true,
          missingComponentIds: [],
        },
        attendance: {
          present: 0,
          absent: 2,
          excused: 0,
          pending: 0,
          consecutiveAbsences: 2,
          maximumConsecutiveAbsences: 2,
          warning: true,
          academicallyEligible: false,
        },
        academicallyPassed: false,
      },
    ],
    sessions: [
      {
        id,
        startsAt: "2026-10-01T12:00:00Z",
        endsAt: "2026-10-01T13:30:00Z",
        cancelledAt: null,
        cancellationReason: null,
        replacementForSessionId: null,
        administrativeReviewRequired: false,
        revision: 1,
        instructorAttendance: {
          status: "ABSENT",
          inferred: true,
          markedBy: null,
          markedAt: null,
          markedByName: null,
        },
        participants: [],
      },
    ],
  };
}
test("academic closure blockers ignore balances and eligibility, retain pending and accept cancelled encounters", () => {
  const r = report(),
    now = new Date("2026-10-02T12:00:00Z");
  expect(closureBlockers(r, now)).toEqual([]);
  r.sessions[0]!.endsAt = "2026-10-03T12:00:00Z";
  r.sessions[0]!.instructorAttendance.status = "PENDING";
  r.participants[0]!.result.status = "PENDING";
  expect(closureBlockers(r, now)).toEqual([
    "SESSIONS_UNFINISHED",
    "GRADES_PENDING",
    "ATTENDANCE_PENDING",
  ]);
  r.sessions[0]!.cancelledAt = "2026-09-30T12:00:00Z";
  expect(closureBlockers(r, now)).toEqual(["GRADES_PENDING"]);
  r.participants[0]!.result.status = "COMPLETE";
  r.scheme.components = [];
  r.participants = [];
  expect(closureBlockers(r, now)).toEqual([]);
});
test("academic closure application requires active roles and mandatory sanitized reopen reason", () => {
  requireClosureActor(actor, true);
  requireClosureActor({ ...actor, roles: ["INSTRUCTOR"] });
  expect(() =>
    requireClosureActor({ ...actor, roles: ["INSTRUCTOR"] }, true),
  ).toThrow();
  expect(() => requireClosureActor({ ...actor, status: "DISABLED" })).toThrow();
  const command = {
    courseId: id,
    groupId: id,
    requestKey: id,
    revision: 0,
    reason: "Corrección",
  };
  validateReopen(command);
  for (const reason of [" ", "x".repeat(501), "bad\nreason"])
    expect(() => validateReopen({ ...command, reason })).toThrow();
  expect(() => validateReopen({ ...command, revision: -1 })).toThrow();
});
test("academic closure HTTP fixes context and actor, supports forms, fails safely and guards private loaders", async () => {
  const calls: unknown[] = [];
  const repository: ClosureRepository = {
    close: async (actorId, input) => {
      calls.push({ actorId, input });
      return {
        groupId: id,
        status: "CLOSED",
        revision: 1,
        version: 1,
        versionId: id,
      };
    },
    reopen: async () => {
      throw new ClosureError("CLOSURE_BLOCKED", "Blocked");
    },
    getGroup: async () => {
      throw new ClosureError("NOT_FOUND", "Unavailable");
    },
    getVersion: async () => {
      throw new Error("internal secret");
    },
  };
  const base = {
    actor,
    repository,
    siteUrl: new URL("http://localhost:44895"),
    operation: "close" as const,
    courseId: id,
    groupId: id,
  };
  function request(body: unknown, origin = base.siteUrl.origin) {
    return new Request(base.siteUrl, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const raw = { requestKey: id, revision: 0 };
  expect(
    (await handleClosurePost({ ...base, request: request(raw) })).status,
  ).toBe(200);
  expect(calls[0]).toEqual({
    actorId: id,
    input: { courseId: id, groupId: id, ...raw },
  });
  expect(
    (
      await handleClosurePost({
        ...base,
        request: new Request(base.siteUrl, {
          method: "POST",
          headers: {
            Origin: base.siteUrl.origin,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ requestKey: id, revision: "0" }),
        }),
      })
    ).status,
  ).toBe(200);
  for (const body of [
    { ...raw, actorId: id },
    { ...raw, groupId: "wrong" },
    { ...raw, revision: "1.5" },
  ])
    expect(
      (await handleClosurePost({ ...base, request: request(body) })).status,
    ).toBe(422);
  expect(
    (
      await handleClosurePost({
        ...base,
        request: request(raw, "http://evil.invalid"),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await handleClosurePost({
        ...base,
        operation: "reopen",
        actor: { ...actor, roles: ["INSTRUCTOR"] },
        request: request({ ...raw, reason: "Correction" }),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await handleClosurePost({
        ...base,
        operation: "reopen",
        request: request(raw),
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await handleClosurePost({
        ...base,
        operation: "reopen",
        request: request({ ...raw, reason: "Correction" }),
      })
    ).status,
  ).toBe(409);
  expect(calls).toHaveLength(2);
  expect(await loadAcademicClosure({ ...base })).toMatchObject({
    available: false,
    status: 404,
    code: "NOT_FOUND",
  });
  expect(closureFailure(new Error("secret"))).toMatchObject({
    status: 503,
    payload: { code: "SERVICE_UNAVAILABLE" },
  });
  expect(JSON.stringify(closureFailure(new Error("secret")))).not.toContain(
    "secret",
  );
  expect(closureJson({ ok: true }).headers.get("Cache-Control")).toBe(
    "private, no-store",
  );
});
