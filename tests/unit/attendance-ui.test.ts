import { expect, test } from "bun:test";
import {
  attendanceFormPayload,
  attendanceFieldIssues,
  markValue,
  validMarkValue,
  durationLabel,
  timeLabel,
} from "@/components/attendance/presentation";
import {
  submitAttendancePage,
  loadAttendanceSessionPage,
} from "@/components/attendance/page-load";
import { getPrivateRoutePolicy } from "@/server/auth/route-policy";
import type { AttendanceRepository } from "@/application/attendance/attendance-repository";
import type { InternalUser } from "@/domain/auth/types";
const actor: InternalUser = {
  id: crypto.randomUUID(),
  authUserId: crypto.randomUUID(),
  email: "attendance@test.invalid",
  name: "Synthetic",
  status: "ACTIVE",
  roles: ["ADMIN"],
};
const context = {
  courseId: crypto.randomUUID(),
  groupId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
};
const siteUrl = new URL("https://test.invalid");
const unused = async (): Promise<never> => {
  throw new Error("Unexpected operation");
};
const repo: AttendanceRepository = {
  getGroup: unused,
  getSession: unused,
  getSettings: unused,
  cancel: unused,
  replace: unused,
  record: unused,
  updateSettings: unused,
};
function request(values: Record<string, string>, operation = "replace") {
  return new Request(
    `${siteUrl}/app/cursos/${context.courseId}/grupos/${context.groupId}/sesiones/${context.sessionId}?operation=${operation}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: siteUrl.origin,
      },
      body: new URLSearchParams(values),
    },
  );
}
test("attendance controls transport only a single explicit mark and keep pending out of commands", () => {
  const id = crypto.randomUUID();
  expect(markValue(id, "PENDING")).toBe("");
  expect(validMarkValue(markValue(id, "EXCUSED"))).toBe(true);
  expect(
    validMarkValue(JSON.stringify([{ registrationId: id, status: "PENDING" }])),
  ).toBe(false);
  expect(timeLabel("2026-10-03T18:30:00.000Z")).toBe("14:30");
  expect(
    durationLabel({
      startsAt: "2026-10-03T18:30:00.000Z",
      endsAt: "2026-10-03T20:00:00.000Z",
    }),
  ).toBe("1 h 30 min");
});
test("replacement SSR date/time binding preserves civil values, submitted fields and backend conflicts", async () => {
  let observed = "";
  const repository = {
    ...repo,
    replace: async (
      _actor: string,
      input: Parameters<AttendanceRepository["replace"]>[1],
    ) => {
      observed = input.startsAt;
      return {
        kind: "session" as const,
        sessionId: input.sessionId,
        revision: input.revision + 1,
      };
    },
  };
  const values = {
    requestKey: crypto.randomUUID(),
    revision: "1",
    replacementDate: "2026-10-04",
    replacementTime: "08:30",
    reason: "Recuperación",
  };
  expect(attendanceFormPayload(values)).toMatchObject({
    startsAt: "2026-10-04T08:30",
  });
  expect(
    attendanceFieldIssues({ startsAt: "Selecciona otro horario." }),
  ).toMatchObject({
    replacementDate: "Selecciona otro horario.",
    replacementTime: "Selecciona otro horario.",
  });
  const result = await submitAttendancePage({
    request: request(values),
    actor,
    repository,
    siteUrl,
    operation: "replace",
    ...context,
  });
  expect(result.payload.ok).toBe(true);
  expect(observed).toBe("2026-10-04T08:30");
  expect(result.values).toEqual(values);
  const invalid = await submitAttendancePage({
    request: request({ ...values, actorId: actor.id }),
    actor,
    repository,
    siteUrl,
    operation: "replace",
    ...context,
  });
  expect(invalid.status).toBe(422);
});
test("attendance settings use their independent revision and never submit financial settings", async () => {
  let observed = 0;
  const values = {
    requestKey: crypto.randomUUID(),
    revision: "2",
    consecutiveAbsenceLimit: "3",
  };
  const repository = {
    ...repo,
    updateSettings: async (
      _actor: string,
      input: Parameters<AttendanceRepository["updateSettings"]>[1],
    ) => {
      observed = input.revision;
      return {
        kind: "settings" as const,
        settings: {
          consecutiveAbsenceLimit: input.consecutiveAbsenceLimit,
          revision: input.revision + 1,
          updatedAt: "2026-10-03T00:00:00.000Z",
        },
      };
    },
  };
  const result = await submitAttendancePage({
    request: request(values, "settings"),
    actor,
    repository,
    siteUrl,
    operation: "settings",
  });
  expect(result.payload.ok).toBe(true);
  expect(observed).toBe(2);
  const denied = await submitAttendancePage({
    request: request({ ...values, minimumPaymentPercent: "25" }, "settings"),
    actor,
    repository,
    siteUrl,
    operation: "settings",
  });
  expect(denied.status).toBe(422);
});
test("attendance pages bind role policies to declared group/session paths and preserve failed form values", async () => {
  const adminPath = `/app/cursos/${context.courseId}/grupos/${context.groupId}/sesiones`;
  const instructorPath = adminPath.replace("/cursos/", "/mis-cursos/");
  expect(getPrivateRoutePolicy(adminPath)).toEqual({
    access: "ROLES",
    roles: ["ADMIN"],
  });
  expect(
    getPrivateRoutePolicy(`${instructorPath}/${context.sessionId}`),
  ).toEqual({ access: "ROLES", roles: ["INSTRUCTOR"] });
  expect(getPrivateRoutePolicy(`${adminPath}/unknown`)).toBeNull();
  expect(getPrivateRoutePolicy("/app/configuracion/asistencia")).toEqual({
    access: "ROLES",
    roles: ["ADMIN"],
  });
  const result = await loadAttendanceSessionPage({
    request: request({
      requestKey: crypto.randomUUID(),
      revision: "1",
      replacementDate: "invalid",
      replacementTime: "08:30",
    }),
    actor,
    repository: repo,
    siteUrl,
    ...context,
  });
  expect(result.values.replacementDate).toBe("invalid");
  expect(result.payload?.ok).toBe(false);
});
