import type { AstroGlobal } from "astro";
import { requireInternalUser } from "@/server/auth/context";
import {
  loadCertificates,
  loadCertificateSettings,
} from "@/server/certificates/loaders";
import { loadAcademicClosure } from "@/server/academic-closure/loaders";
import {
  certificateRecipients,
  validateCertificateConfiguration,
} from "@/domain/certificates/rules";
import type { CertificateType } from "@/domain/certificates/types";
import {
  certificateMutation,
  certificateMethodNotAllowed,
  emptyFeedback,
  setCertificateHeaders,
} from "./route";

export async function prepareGroupCertificates(
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
    groupId = astro.params.groupId ?? "";
  const context = { actor, courseId, groupId };
  let feedback = emptyFeedback();
  if (astro.request.method === "POST") {
    const result = await certificateMutation(astro, "generate");
    if (result instanceof Response) return result;
    feedback = result;
  }
  const load = await loadCertificates(context);
  if (!load.available) astro.response.status = load.status;
  const closure =
    !instructorRoute && load.available
      ? await loadAcademicClosure(context)
      : null;
  const settings =
    !instructorRoute && load.available
      ? await loadCertificateSettings({ actor })
      : null;
  const current =
    closure?.available && closure.data.status === "CLOSED"
      ? closure.data.official
      : null;
  const report =
    current?.report ?? (closure?.available ? closure.data.provisional : null);
  const title =
    report?.courseName ??
    (load.available ? load.data[0]?.data.courseName : null) ??
    "Certificados del grupo";
  const selectedReplacement = load.available
    ? load.data.find(
        (record) =>
          record.id === astro.url.searchParams.get("reemplazar") &&
          (record.state === "issued" || record.state === "revoked"),
      )
    : undefined;
  const generation: {
    type: CertificateType;
    recipients: { id: string; name: string }[];
    blocked: string;
  }[] = [];
  if (current?.report.access === "ADMIN" && settings?.available) {
    for (const type of ["APPROVAL", "INSTRUCTOR"] as const) {
      if (selectedReplacement && selectedReplacement.type !== type) continue;
      let recipients: { id: string; name: string }[] = [],
        blocked = "";
      try {
        recipients = certificateRecipients(current.report, type);
        validateCertificateConfiguration(
          settings.data.configuration,
          true,
          type,
        );
      } catch (error) {
        blocked =
          error instanceof Error
            ? error.message
            : "Revisa los datos necesarios antes de generar.";
      }
      generation.push({ type, recipients, blocked });
    }
  }
  return {
    load,
    closure,
    settings,
    current,
    title,
    groupName: report?.groupName ?? "",
    selectedReplacement,
    generation,
    feedback,
    courseId,
    groupId,
    instructorRoute,
    path: astro.url.pathname,
  };
}
export type GroupCertificateProps = Exclude<
  Awaited<ReturnType<typeof prepareGroupCertificates>>,
  Response
>;
