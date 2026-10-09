import type { AstroGlobal } from "astro";
import { requireInternalUser } from "@/server/auth/context";
import {
  loadCertificate,
  loadCertificateHistory,
} from "@/server/certificates/loaders";
import { certificateJson } from "@/server/certificates/http";
import {
  certificateMethodNotAllowed,
  certificateMutation,
  emptyFeedback,
  setCertificateHeaders,
} from "./route";

export async function prepareCertificateDetail(
  astro: AstroGlobal,
  instructorRoute: boolean,
) {
  setCertificateHeaders(astro);
  if (
    !["GET", ...(instructorRoute ? [] : ["POST"])].includes(
      astro.request.method,
    )
  )
    return certificateMethodNotAllowed(instructorRoute ? "GET" : "GET, POST");
  const actor = requireInternalUser(astro.locals);
  const id = astro.params.certificateId ?? "";
  let feedback = emptyFeedback();
  if (astro.request.method === "POST") {
    const operation = astro.url.searchParams.get("operation");
    if (
      operation !== "review" &&
      operation !== "issue" &&
      operation !== "revoke"
    )
      return certificateJson(
        {
          ok: false,
          code: "VALIDATION_FAILED",
          message: "Operación no válida.",
          issues: {},
        },
        422,
      );
    const result = await certificateMutation(astro, operation);
    if (result instanceof Response) return result;
    feedback = result;
  }
  const load = await loadCertificate({ actor, id });
  if (!load.available) astro.response.status = load.status;
  if (astro.request.headers.get("Accept")?.includes("application/json"))
    return certificateJson(load, load.available ? 200 : load.status);
  const history =
    !instructorRoute && load.available
      ? await loadCertificateHistory({ actor, id })
      : null;
  return {
    load,
    history,
    feedback,
    instructorRoute,
    path: astro.url.pathname,
    requestKey: crypto.randomUUID(),
  };
}
export type CertificateDetailProps = Exclude<
  Awaited<ReturnType<typeof prepareCertificateDetail>>,
  Response
>;
