/** Server-only presentation adapter: keep the established HTTP/domain contracts intact. */
import type { InternalUser } from "@/domain/auth/types";
import type { AttendanceRepository } from "@/application/attendance/attendance-repository";
import { getAttendanceSession } from "@/application/attendance/manage-attendance";
import {
  attendanceFailure,
  handleAttendancePost,
  type AttendanceOperation,
  type AttendanceHttpPayload,
} from "@/server/attendance/http";
import { readInterestRequest } from "@/server/interests/request";
import { AttendanceError } from "@/domain/attendance/rules";
import { attendanceFormPayload } from "./presentation";
export async function submitAttendancePage(input: {
  request: Request;
  actor: InternalUser;
  repository: AttendanceRepository;
  siteUrl: URL;
  operation: AttendanceOperation;
  courseId?: string;
  groupId?: string;
  sessionId?: string;
}) {
  let values: Record<string, string> = {};
  try {
    const raw: unknown = await readInterestRequest(
      input.request.clone(),
      65_536,
    );
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      values = Object.fromEntries(
        Object.entries(raw).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      if (
        input.operation === "replace" &&
        ("replacementDate" in values || "replacementTime" in values)
      ) {
        const headers = new Headers(input.request.headers);
        headers.delete("content-length");
        headers.set("content-type", "application/json");
        const body = { ...raw, ...attendanceFormPayload(values) } as Record<
          string,
          unknown
        >;
        delete body.replacementDate;
        delete body.replacementTime;
        input = {
          ...input,
          request: new Request(input.request, {
            headers,
            body: JSON.stringify(body),
          }),
        };
      }
    }
    const result = await handleAttendancePost(input);
    return { ...result, values };
  } catch (error) {
    return { ...attendanceFailure(error), values };
  }
}
export async function loadAttendanceSessionPage(input: {
  request: Request;
  actor: InternalUser;
  repository: AttendanceRepository;
  siteUrl: URL;
  courseId: string;
  groupId: string;
  sessionId: string;
}) {
  let values: Record<string, string> = {},
    operation: AttendanceOperation | undefined,
    payload: AttendanceHttpPayload | undefined,
    status = 200;
  if (input.request.method === "POST") {
    const candidates = new URL(input.request.url).searchParams.getAll(
      "operation",
    );
    if (
      candidates.length !== 1 ||
      !["record", "cancel", "replace"].includes(candidates[0] ?? "")
    ) {
      const result = attendanceFailure(
        new AttendanceError(
          "VALIDATION_FAILED",
          "Selecciona una operación válida.",
        ),
      );
      return {
        detail: null,
        values,
        operation,
        payload: result.payload,
        status: result.status,
      };
    }
    operation = candidates[0] as AttendanceOperation;
    const result = await submitAttendancePage({ ...input, operation });
    values = result.values;
    payload = result.payload;
    status = result.status;
    if (payload.ok) return { detail: null, values, operation, payload, status };
  }
  try {
    const detail = await getAttendanceSession(
      input.repository,
      input.actor,
      input.courseId,
      input.groupId,
      input.sessionId,
    );
    return { detail, values, operation, payload, status };
  } catch (error) {
    const result = attendanceFailure(error);
    return {
      detail: null,
      values,
      operation,
      payload: result.payload,
      status: result.status,
    };
  }
}
