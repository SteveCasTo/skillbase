import type { AstroGlobal } from "astro";
import type {
  ClosureStateDto,
  ClosureVersionDto,
} from "@/domain/academic-closure/types";
import { requireInternalUser } from "@/server/auth/context";
import { getPublicAuthEnvironment } from "@/server/environment";
import {
  closureFailure,
  closureHeaders,
  closureJson,
  handleClosurePost,
  type ClosureOperation,
} from "@/server/academic-closure/http";
import {
  loadAcademicClosure,
  loadAcademicClosureVersion,
  type ClosureLoadResult,
} from "@/server/academic-closure/loaders";
import { getClosureRepository } from "@/server/academic-closure/service";
import { readInterestRequest } from "@/server/interests/request";

export interface ClosureRouteData {
  load: ClosureLoadResult<ClosureStateDto>;
  historical?: ClosureLoadResult<ClosureVersionDto>;
  courseId: string;
  groupId: string;
  instructorRoute: boolean;
  version?: number;
  requestKey: string;
  attemptedRevision?: string;
  reason: string;
  issues: Readonly<Record<string, string>>;
  message: string;
  operation?: ClosureOperation;
  success: boolean;
}

export function parseClosureVersion(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) ? version : null;
}

/** Presentation adapter only. Identity, clock and context never come from the form. */
export async function prepareClosureRoute(
  astro: AstroGlobal,
  instructorRoute: boolean,
): Promise<Response | ClosureRouteData> {
  for (const [name, value] of Object.entries(closureHeaders))
    astro.response.headers.set(name, value);
  const historical = astro.params.version !== undefined;
  const allowed = historical ? ["GET"] : ["GET", "POST"];
  if (!allowed.includes(astro.request.method))
    return new Response(null, {
      status: 405,
      headers: { ...closureHeaders, Allow: allowed.join(", ") },
    });
  const actor = requireInternalUser(astro.locals);
  const courseId = astro.params.id ?? "",
    groupId = astro.params.groupId ?? "";
  const context = { actor, courseId, groupId };
  const wantsJson = astro.request.headers
    .get("Accept")
    ?.includes("application/json");
  const version = historical
    ? parseClosureVersion(astro.params.version ?? "")
    : null;
  if (historical && version === null)
    return new Response("Versión no disponible.", {
      status: 404,
      headers: closureHeaders,
    });
  const state: ClosureRouteData = {
    load: await loadAcademicClosure(context),
    courseId,
    groupId,
    instructorRoute,
    requestKey: crypto.randomUUID(),
    reason: "",
    issues: {},
    message: "",
    success: false,
    ...(version === null
      ? {}
      : {
          version,
          historical: await loadAcademicClosureVersion({ ...context, version }),
        }),
  };
  if (astro.request.method === "POST") {
    const operation = astro.url.searchParams.get("operation");
    if (operation !== "close" && operation !== "reopen")
      return closureJson(
        {
          ok: false,
          code: "VALIDATION_FAILED",
          message: "Operación no válida.",
          issues: {},
        },
        422,
      );
    state.operation = operation;
    let request = astro.request;
    try {
      // Preserve the HTML draft and exact key on uncertain failures, with the same
      // size/duplicate-field validation as the core HTTP adapter.
      if (!wantsJson) {
        const raw: unknown = await readInterestRequest(request, 65536);
        const fields =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {};
        if (typeof fields.requestKey === "string")
          state.requestKey = fields.requestKey;
        if (typeof fields.revision === "string")
          state.attemptedRevision = fields.revision;
        if (typeof fields.reason === "string") state.reason = fields.reason;
        const headers = new Headers(request.headers);
        headers.set("Content-Type", "application/json");
        headers.delete("Content-Length");
        request = new Request(request.url, {
          method: "POST",
          headers,
          body: JSON.stringify(raw),
        });
      }
      const result = await handleClosurePost({
        ...context,
        request,
        operation,
        repository: getClosureRepository(),
        siteUrl: getPublicAuthEnvironment().siteUrl,
      });
      if (wantsJson) return closureJson(result.payload, result.status);
      astro.response.status = result.status;
      if (result.payload.ok) {
        state.success = true;
        state.reason = "";
        state.requestKey = crypto.randomUUID();
        delete state.attemptedRevision;
      } else {
        state.message = result.payload.message;
        state.issues = result.payload.issues;
      }
      // Success and conflicts both render a freshly authorized state. Receipts
      // contain no report and cannot be used as the official presentation.
      state.load = await loadAcademicClosure(context);
      if (result.status === 409) {
        state.requestKey = crypto.randomUUID();
        delete state.attemptedRevision;
      }
    } catch (error) {
      const failure = closureFailure(error);
      astro.response.status = failure.status;
      state.message = failure.payload.message;
      state.issues = failure.payload.issues;
    }
  }
  const effectiveLoad = state.historical ?? state.load;
  if (wantsJson)
    return closureJson(
      effectiveLoad,
      effectiveLoad.available ? 200 : effectiveLoad.status,
    );
  if (!effectiveLoad.available) astro.response.status = effectiveLoad.status;
  return state;
}
