import type { AstroGlobal } from "astro";
import type { EvaluationComponentInput } from "@/domain/evaluations/types";
import { requireInternalUser } from "@/server/auth/context";
import { getPublicAuthEnvironment } from "@/server/environment";
import {
  evaluationHeaders,
  evaluationFailure,
  evaluationJson,
  handleEvaluationPost,
} from "@/server/evaluations/http";
import {
  loadCourseEvaluations,
  type EvaluationLoadResult,
} from "@/server/evaluations/loaders";
import { getEvaluationRepository } from "@/server/evaluations/service";
import { readInterestRequest } from "@/server/interests/request";

function adaptedRequest(original: Request, body: unknown): Request {
  const headers = new Headers(original.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  return new Request(original.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export interface EvaluationRouteData {
  load: EvaluationLoadResult;
  courseId: string;
  groupId?: string;
  instructorRoute: boolean;
  attemptedComponents?: EvaluationComponentInput[];
  attemptedGrade?: {
    registrationId: string;
    componentId: string;
    score: string;
    gradeRevision: string;
    schemeRevision: string;
    requestKey: string;
  };
  attemptedRevision?: string;
  requestKey: string;
  issues: Readonly<Record<string, string>>;
  message: string;
  success: boolean;
}

/** Page-level progressive form adaptation; all mutations use the backend handler. */
export async function prepareEvaluationRoute(
  astro: AstroGlobal,
  instructorRoute: boolean,
): Promise<Response | EvaluationRouteData> {
  astro.response.headers.set(
    "Cache-Control",
    evaluationHeaders["Cache-Control"],
  );
  const courseId = astro.params.id ?? "";
  const groupId = astro.params.groupId;
  const actor = requireInternalUser(astro.locals);
  const route = { actor, courseId, ...(groupId ? { groupId } : {}) };
  const wantsJson = astro.request.headers
    .get("Accept")
    ?.includes("application/json");
  if (!["GET", "POST"].includes(astro.request.method))
    return new Response(null, {
      status: 405,
      headers: { ...evaluationHeaders, Allow: "GET, POST" },
    });
  const state: EvaluationRouteData = {
    load: await loadCourseEvaluations(route),
    courseId,
    ...(groupId ? { groupId } : {}),
    instructorRoute,
    requestKey: crypto.randomUUID(),
    issues: {},
    message: "",
    success: astro.url.searchParams.get("saved") === "1",
  };
  if (astro.request.method === "POST") {
    let request = astro.request;
    if (!wantsJson) {
      let raw: unknown;
      try {
        raw = await readInterestRequest(astro.request, 65536);
      } catch (error) {
        const failure = evaluationFailure(error);
        astro.response.status = failure.status;
        state.message = failure.payload.message;
        state.issues = failure.payload.issues;
        return state;
      }
      const fields =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
      const value = (name: string) =>
        typeof fields[name] === "string" ? (fields[name] as string) : "";
      state.requestKey = value("requestKey");
      if (!groupId) {
        state.attemptedComponents = Object.keys(fields)
          .filter((key) => /^componentId\.\d+$/u.test(key))
          .sort((a, b) => Number(a.split(".")[1]) - Number(b.split(".")[1]))
          .map((key) => {
            const index = key.split(".")[1];
            return {
              id: value(key),
              name: value(`componentName.${index}`),
              type: value(
                `componentType.${index}`,
              ) as EvaluationComponentInput["type"],
              weight: value(`componentWeight.${index}`),
            };
          });
        state.attemptedRevision = value("schemeRevision");
        // Adding/removing a row edits this form only; it cannot change persisted structure.
        const edit = value("editingAction");
        if (state.load.available && state.load.data.scheme.canEdit && edit) {
          if (edit === "add")
            state.attemptedComponents.push({
              id: crypto.randomUUID(),
              name: "",
              type: "THEORY",
              weight: "",
            });
          else if (edit.startsWith("remove:"))
            state.attemptedComponents = state.attemptedComponents.filter(
              (component) => component.id !== edit.slice(7),
            );
          return state;
        }
        request = adaptedRequest(astro.request, {
          requestKey: state.requestKey,
          schemeRevision: value("schemeRevision"),
          components: state.attemptedComponents,
        });
      } else {
        state.attemptedGrade = {
          registrationId: value("registrationId"),
          componentId: value("componentId"),
          score: value("score"),
          gradeRevision: value("gradeRevision"),
          schemeRevision: value("schemeRevision"),
          requestKey: state.requestKey,
        };
        request = adaptedRequest(astro.request, state.attemptedGrade);
      }
    }
    const result = await handleEvaluationPost({
      ...route,
      request,
      repository: getEvaluationRepository(),
      siteUrl: getPublicAuthEnvironment().siteUrl,
      operation: groupId ? "grade" : "scheme",
    });
    if (wantsJson) return evaluationJson(result.payload, result.status);
    if (result.payload.ok)
      return astro.redirect(`${astro.url.pathname}?saved=1`, 303);
    astro.response.status = result.status;
    state.issues = result.payload.issues;
    state.message = result.payload.message;
  }
  if (wantsJson)
    return evaluationJson(
      state.load,
      state.load.available ? 200 : state.load.status,
    );
  if (!state.load.available) astro.response.status = state.load.status;
  return state;
}
