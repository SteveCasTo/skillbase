import { expect, test } from "bun:test";
import type { InternalUser } from "@/domain/auth/types";
import type { AttendanceRepository } from "@/application/attendance/attendance-repository";
import {
  attendanceFailure,
  handleAttendancePost,
} from "@/server/attendance/http";
import { AttendanceError } from "@/domain/attendance/rules";
const actor: InternalUser = {
  id: crypto.randomUUID(),
  authUserId: crypto.randomUUID(),
  email: "synthetic@test.invalid",
  name: "Synthetic",
  status: "ACTIVE",
  roles: ["ADMIN"],
};
const route = {
  courseId: crypto.randomUUID(),
  groupId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
};
const siteUrl = new URL("https://test.invalid");
let calls = 0;
const unused = async (): Promise<never> => {
  throw new Error("Unexpected repository operation");
};
const repository: AttendanceRepository = {
  getGroup: unused,
  getSession: unused,
  getSettings: unused,
  cancel: unused,
  replace: unused,
  updateSettings: unused,
  record: async (_actor, input) => {
    calls++;
    return {
      kind: "session",
      sessionId: input.sessionId,
      revision: input.revision + 1,
    };
  },
};
const request = (body: unknown, origin = siteUrl.origin) =>
  new Request(`${siteUrl}/app/synthetic`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
test("attendance HTTP enforces origin, body limit and unknown fields before persistence", async () => {
  calls = 0;
  const base = { requestKey: crypto.randomUUID(), revision: 1, marks: [] };
  expect(
    (
      await handleAttendancePost({
        request: request(base, "https://evil.invalid"),
        actor,
        repository,
        siteUrl,
        operation: "record",
        ...route,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await handleAttendancePost({
        request: request({ ...base, actorId: actor.id }),
        actor,
        repository,
        siteUrl,
        operation: "record",
        ...route,
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await handleAttendancePost({
        request: request({ ...base, marks: "x".repeat(66000) }),
        actor,
        repository,
        siteUrl,
        operation: "record",
        ...route,
      })
    ).status,
  ).toBe(413);
  expect(calls).toBe(0);
});
test("attendance HTTP binds route identifiers, validates duplicate marks and returns envelope", async () => {
  calls = 0;
  const base = { requestKey: crypto.randomUUID(), revision: "1", marks: [] };
  expect(
    (
      await handleAttendancePost({
        request: request({ ...base, sessionId: crypto.randomUUID() }),
        actor,
        repository,
        siteUrl,
        operation: "record",
        ...route,
      })
    ).status,
  ).toBe(422);
  const mark = { registrationId: crypto.randomUUID(), status: "PRESENT" };
  expect(
    (
      await handleAttendancePost({
        request: request({ ...base, marks: [mark, mark] }),
        actor,
        repository,
        siteUrl,
        operation: "record",
        ...route,
      })
    ).status,
  ).toBe(422);
  const result = await handleAttendancePost({
    request: request(base),
    actor,
    repository,
    siteUrl,
    operation: "record",
    ...route,
  });
  expect(result).toMatchObject({
    status: 200,
    payload: {
      ok: true,
      value: { kind: "session", sessionId: route.sessionId, revision: 2 },
    },
  });
  expect(calls).toBe(1);
});
test("attendance HTTP sanitizes infrastructure errors and maps optimistic conflicts", () => {
  expect(
    attendanceFailure(new Error("postgres password secret")),
  ).toMatchObject({ status: 503, payload: { code: "SERVICE_UNAVAILABLE" } });
  expect(
    JSON.stringify(attendanceFailure(new Error("postgres password secret"))),
  ).not.toContain("secret");
  expect(
    attendanceFailure(new AttendanceError("CONCURRENT_UPDATE", "Recarga")),
  ).toMatchObject({
    status: 409,
    payload: { ok: false, code: "CONCURRENT_UPDATE" },
  });
});
