import type { AstroGlobal } from "astro";
import type { CertificateType } from "@/domain/certificates/types";
import { requireInternalUser } from "@/server/auth/context";
import {
  certificateRecipients,
  CertificateError,
} from "@/domain/certificates/rules";
import { loadAcademicClosure } from "@/server/academic-closure/loaders";
import {
  loadCertificates,
  loadCertificateSettings,
} from "@/server/certificates/loaders";
import {
  certificateFailure,
  certificateJson,
} from "@/server/certificates/http";
import {
  certificateMethodNotAllowed,
  certificateMutation,
  emptyFeedback,
  setCertificateHeaders,
} from "./route";

export async function prepareCertificateRecipient(
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
  const courseId = astro.params.id ?? "",
    groupId = astro.params.groupId ?? "",
    recipientId = astro.params.recipientId ?? "";
  const type: CertificateType | null =
    astro.params.type === "approval"
      ? "APPROVAL"
      : astro.params.type === "instructor"
        ? "INSTRUCTOR"
        : null;
  const context = { actor, courseId, groupId };
  try {
    if (!type)
      throw new CertificateError("NOT_FOUND", "Certificado no disponible.");
    const records = await loadCertificates(context);
    const closure = await loadAcademicClosure(context);
    if (!records.available || !closure.available)
      throw new CertificateError("NOT_FOUND", "Grupo no disponible.");
    const current =
      closure.data.status === "CLOSED" ? closure.data.official : null;
    if (!current)
      throw new CertificateError(
        "STALE_CLOSURE",
        "El grupo necesita un cierre oficial vigente.",
      );
    const recipient = certificateRecipients(current.report, type).find(
      (r) => r.id === recipientId,
    );
    if (!recipient)
      throw new CertificateError("NOT_FOUND", "Destinatario no disponible.");
    const record = records.data.find(
      (r) => r.type === type && r.recipientId === recipientId,
    );
    if (astro.request.method === "GET" && record)
      return astro.redirect(
        `${instructorRoute ? "/app/mis-certificados" : "/app/certificados"}/${record.id}`,
        302,
      );
    let feedback = emptyFeedback();
    if (astro.request.method === "POST") {
      const result = await certificateMutation(astro, "generate");
      if (result instanceof Response) return result;
      feedback = result;
      if (result.success) return astro.redirect(astro.url.pathname, 303);
    }
    const settings = !instructorRoute
      ? await loadCertificateSettings({ actor })
      : null;
    return {
      type,
      recipient,
      current,
      closureRevision: closure.data.revision,
      settings,
      feedback,
      instructorRoute,
      courseId,
      groupId,
      path: astro.url.pathname,
    };
  } catch (error) {
    const failure = certificateFailure(error);
    return certificateJson(failure.payload, failure.status);
  }
}
export type CertificateRecipientProps = Exclude<
  Awaited<ReturnType<typeof prepareCertificateRecipient>>,
  Response
>;
