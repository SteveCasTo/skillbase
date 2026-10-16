import type { AstroGlobal } from "astro";
import { requireInternalUser } from "@/server/auth/context";
import {
  loadCertificate,
  loadCertificates,
  loadCertificateSettings,
} from "@/server/certificates/loaders";
import { loadAcademicClosure } from "@/server/academic-closure/loaders";
import { canReissueCertificate } from "@/domain/certificates/rules";
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
    if (operation !== "revoke")
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
  const record = load.available ? load.data : null;
  const context = record
    ? { actor, courseId: record.courseId, groupId: record.groupId }
    : null;
  const records = context ? await loadCertificates(context) : null;
  const history =
    records?.available && record
      ? records.data.filter(
          (r) =>
            r.type === record.type &&
            r.recipientId === record.recipientId &&
            r.state === "revoked" &&
            r.id !== record.id,
        )
      : [];
  const closure =
    context && !instructorRoute && record?.state === "revoked"
      ? await loadAcademicClosure(context)
      : null;
  const official =
    closure?.available && closure.data.status === "CLOSED"
      ? closure.data.official
      : null;
  const settings = official ? await loadCertificateSettings({ actor }) : null;
  const reissue =
    record &&
    records?.available &&
    official &&
    settings?.available &&
    closure?.available &&
    canReissueCertificate(record, records.data, official.report)
      ? {
          versionId: official.id,
          closureRevision: closure.data.revision,
          configurationRevision: settings.data.revision,
          path: `/app/cursos/${record.courseId}/grupos/${record.groupId}/certificados/${record.type.toLowerCase()}/${record.recipientId}`,
        }
      : null;
  return {
    load,
    feedback,
    instructorRoute,
    path: astro.url.pathname,
    requestKey: crypto.randomUUID(),
    history,
    reissue,
  };
}
export type CertificateDetailProps = Exclude<
  Awaited<ReturnType<typeof prepareCertificateDetail>>,
  Response
>;
