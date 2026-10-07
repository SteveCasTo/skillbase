import { expect, test } from "bun:test";
import {
  attendanceFormPayload,
  attendanceFieldIssues,
  sessionCancellationLabel,
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
import { filterSessionRows } from "@/components/attendance/session-filter";
import { prepareGroupParticipantsRoute } from "@/components/attendance/participants-route";
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
test("holiday choice uses the persisted cancellation reason without inventing a session status", async () => {
  const persisted: {
    status: "COMPLETED" | "CANCELLED";
    cancellationReason: string | null;
  } = { status: "COMPLETED", cancellationReason: null };
  const repository = {
    ...repo,
    cancel: async (
      _actor: string,
      input: Parameters<AttendanceRepository["cancel"]>[1],
    ) => {
      persisted.status = "CANCELLED";
      persisted.cancellationReason = input.reason ?? null;
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
    cancellationReasonChoice: "holiday",
    reason: "Texto de otro motivo",
  };
  expect(attendanceFormPayload(values, "cancel").reason).toBe("Feriado");
  expect(attendanceFormPayload(values, "cancel")).not.toHaveProperty(
    "cancellationReasonChoice",
  );
  const result = await submitAttendancePage({
    request: request(values, "cancel"),
    actor,
    repository,
    siteUrl,
    operation: "cancel",
    ...context,
  });
  expect(result.payload.ok).toBe(true);
  expect(sessionCancellationLabel(persisted)).toBe("Feriado");
  expect(
    sessionCancellationLabel({
      status: "UPCOMING",
      cancellationReason: "Feriado",
    }),
  ).toBe("");
  expect(
    attendanceFormPayload(
      { ...values, cancellationReasonChoice: "other" },
      "cancel",
    ).reason,
  ).toBe(values.reason);
});
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
  expect(
    getPrivateRoutePolicy(adminPath.replace(/sesiones$/u, "participantes")),
  ).toEqual({ access: "ROLES", roles: ["ADMIN"] });
  expect(
    getPrivateRoutePolicy(
      instructorPath.replace(/sesiones$/u, "participantes"),
    ),
  ).toEqual({ access: "ROLES", roles: ["INSTRUCTOR"] });
  expect(
    getPrivateRoutePolicy(
      `${instructorPath.replace(/sesiones$/u, "participantes")}/${context.sessionId}`,
    ),
  ).toBeNull();
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
test("calendar selection exposes only matching SSR session links and reset restores them", () => {
  const rows = [
    { hidden: false, dataset: { sessionDay: "2026-10-05" } },
    { hidden: false, dataset: { sessionDay: "2026-10-06" } },
    { hidden: false, dataset: { sessionDay: "2026-10-06" } },
  ];
  filterSessionRows(rows, "2026-10-06");
  expect(
    rows.filter((row) => !row.hidden).map((row) => row.dataset.sessionDay),
  ).toEqual(["2026-10-06", "2026-10-06"]);
  filterSessionRows(rows, "2026-10-05");
  expect(rows.filter((row) => !row.hidden)).toEqual([rows[0]!]);
  filterSessionRows(rows, "");
  expect(rows.every((row) => !row.hidden)).toBe(true);
});
test("group participant pages reject the wrong role before accessing private data", async () => {
  const adminData = await prepareGroupParticipantsRoute({
    locals: { internalUser: { ...actor, roles: ["INSTRUCTOR"] } },
    params: { id: context.courseId, groupId: context.groupId },
    url: siteUrl,
  });
  expect(adminData.status).toBe(403);
  expect(adminData.entries).toEqual([]);
  expect(adminData.registrations).toBeNull();
  const instructorData = await prepareGroupParticipantsRoute(
    {
      locals: { internalUser: actor },
      params: { id: context.courseId, groupId: context.groupId },
      url: siteUrl,
    },
    true,
  );
  expect(instructorData.status).toBe(403);
  expect(instructorData.entries).toEqual([]);
  expect(instructorData.registrations).toBeNull();
});
