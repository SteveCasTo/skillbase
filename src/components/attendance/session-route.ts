import type { AttendanceSessionDetailDto } from "@/domain/attendance/types";
import type { AttendanceOperation } from "@/server/attendance/http";
import { attendanceJson, attendanceFailure } from "@/server/attendance/http";
import { requireInternalUser } from "@/server/auth/context";
import { getPublicAuthEnvironment } from "@/server/environment";
import { getAttendanceRepository } from "@/server/attendance/service";
import { civilDay } from "@/domain/attendance/rules";
import { loadAttendanceSessionPage } from "./page-load";
import { attendanceGroupLabel } from "./group-label";
export interface AttendanceSessionPageProps {
  detail: AttendanceSessionDetailDto | null;
  path: string;
  groupLabel: string;
  instructorRoute: boolean;
  isAdmin: boolean;
  correction: boolean;
  fragment: boolean;
  values: Record<string, string>;
  errors: Readonly<Record<string, string>>;
  message: string;
  failedOperation: AttendanceOperation | undefined;
}
export async function prepareAttendanceSessionRoute(context: {
  request: Request;
  params: Record<string, string | undefined>;
  locals: App.Locals;
  url: URL;
}): Promise<{
  response: Response | undefined;
  status: number;
  props: AttendanceSessionPageProps | undefined;
}> {
  if (!["GET", "POST"].includes(context.request.method))
    return {
      response: new Response(null, {
        status: 405,
        headers: { Allow: "GET, POST", "Cache-Control": "private, no-store" },
      }),
      status: 405,
      props: undefined,
    };
  const actor = requireInternalUser(context.locals);
  const instructorRoute = context.url.pathname.startsWith("/app/mis-cursos/");
  const courseId = context.params.id ?? "",
    groupId = context.params.groupId ?? "",
    sessionId = context.params.sessionId ?? "";
  const wantsJson =
    context.request.headers.get("accept")?.includes("application/json") ??
    false;
  const fragment =
    context.request.method === "GET" &&
    context.request.headers.get("X-Attendance-Fragment") === "1";
  const result = await loadAttendanceSessionPage({
    request: context.request,
    actor,
    repository: getAttendanceRepository(),
    siteUrl: getPublicAuthEnvironment().siteUrl,
    courseId,
    groupId,
    sessionId,
  });
  if (result.payload?.ok) {
    if (wantsJson)
      return {
        response: attendanceJson(result.payload, result.status),
        status: result.status,
        props: undefined,
      };
    const target =
      result.payload.value.kind === "session"
        ? result.payload.value.sessionId
        : sessionId;
    return {
      response: new Response(null, {
        status: 303,
        headers: {
          Location: `${context.url.pathname.slice(0, context.url.pathname.lastIndexOf("/"))}/${target}?success=attendance`,
          "Cache-Control": "private, no-store",
        },
      }),
      status: 303,
      props: undefined,
    };
  }
  if (result.payload && !result.payload.ok && (wantsJson || fragment))
    return {
      response: attendanceJson(result.payload, result.status),
      status: result.status,
      props: undefined,
    };
  if (wantsJson)
    return {
      response: attendanceJson({ ok: true, detail: result.detail }),
      status: 200,
      props: undefined,
    };
  let groupLabel = "Grupo";
  let detail = result.detail,
    status = result.status;
  let failure =
    result.payload && !result.payload.ok ? result.payload : undefined;
  try {
    if (result.detail)
      groupLabel = await attendanceGroupLabel(
        actor,
        courseId,
        groupId,
        instructorRoute,
      );
  } catch (error) {
    const unavailable = attendanceFailure(error);
    if (fragment)
      return {
        response: attendanceJson(unavailable.payload, unavailable.status),
        status: unavailable.status,
        props: undefined,
      };
    detail = null;
    status = unavailable.status;
    failure = unavailable.payload;
  }
  return {
    response: undefined,
    status,
    props: {
      detail,
      path: context.url.pathname,
      groupLabel,
      instructorRoute,
      isAdmin: actor.roles.includes("ADMIN"),
      correction:
        actor.roles.includes("ADMIN") &&
        Boolean(detail && detail.session.civilDate < civilDay(new Date())),
      fragment,
      values: result.values,
      errors: failure?.issues ?? {},
      message: failure?.message ?? "",
      failedOperation: result.operation,
    },
  };
}
