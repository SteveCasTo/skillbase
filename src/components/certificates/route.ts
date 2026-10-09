import type { AstroGlobal, APIContext } from "astro";
import { requireInternalUser } from "@/server/auth/context";
import { getPublicAuthEnvironment } from "@/server/environment";
import {
  certificateFailure,
  certificateHeaders,
  certificateJson,
  downloadCertificate,
  handleCertificatePost,
  handleCertificateUpload,
} from "@/server/certificates/http";
import {
  getCertificateRepository,
  getCertificateService,
} from "@/server/certificates/service";
import { readInterestRequest } from "@/server/interests/request";
import type { CertificateConfiguration } from "@/domain/certificates/types";

export interface CertificateFeedback {
  message: string;
  issues: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string>>;
  success: boolean;
}
export const emptyFeedback = (): CertificateFeedback => ({
  message: "",
  issues: {},
  values: {},
  success: false,
});
type Operation = Parameters<typeof handleCertificatePost>[0]["operation"];

/** HTML presentation mapping only; the core validates all operations and drafts. */
export async function certificateMutation(
  astro: AstroGlobal,
  operation: Operation,
  configuration?: CertificateConfiguration,
): Promise<CertificateFeedback | Response> {
  const feedback = emptyFeedback();
  try {
    const raw: unknown = await readInterestRequest(astro.request, 65536);
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Invalid certificate form");
    const fields = raw as Record<string, unknown>;
    for (const [key, value] of Object.entries(fields))
      if (typeof value === "string")
        feedback.values = { ...feedback.values, [key]: value };
    let body = raw;
    if (
      operation === "settings" &&
      configuration &&
      !("configuration" in fields)
    ) {
      const authorityKeys = ["director", "dean", "departmentHead"] as const;
      const allowed = [
        "revision",
        ...authorityKeys.flatMap((key) => [
          `${key}.name`,
          `${key}.role`,
          `${key}.affiliation`,
        ]),
        "approvalInstructor.role",
        "approvalInstructor.affiliation",
      ];
      if (Object.keys(fields).some((key) => !allowed.includes(key)))
        return certificateJson(
          {
            ok: false,
            code: "VALIDATION_FAILED",
            message: "Campos no admitidos.",
            issues: {},
          },
          422,
        );
      const field = (key: string) =>
        typeof fields[key] === "string" ? fields[key] : "";
      const authority = (key: string) => ({
        name: field(`${key}.name`),
        role: field(`${key}.role`),
        affiliation: field(`${key}.affiliation`),
      });
      body = {
        revision: fields.revision,
        configuration: {
          ...configuration,
          director: authority("director"),
          dean: authority("dean"),
          departmentHead: authority("departmentHead"),
          approvalInstructor: {
            role: field("approvalInstructor.role"),
            affiliation: field("approvalInstructor.affiliation"),
          },
        },
      };
    }
    // Optional ordinal is omitted, letting the authoritative core compute it.
    if (operation === "generate" && fields.groupNumber === "") {
      const { groupNumber: _emptyOrdinal, ...rest } = fields;
      void _emptyOrdinal;
      body = rest;
    }
    const headers = new Headers(astro.request.headers);
    headers.set("Content-Type", "application/json");
    headers.delete("Content-Length");
    const request = new Request(astro.request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const result = await handleCertificatePost({
      request,
      operation,
      actor: requireInternalUser(astro.locals),
      siteUrl: getPublicAuthEnvironment().siteUrl,
      repository: getCertificateRepository(),
      ...(operation === "generate"
        ? {
            service: getCertificateService(),
            courseId: astro.params.id ?? "",
            groupId: astro.params.groupId ?? "",
          }
        : {}),
      ...(operation === "review" ||
      operation === "issue" ||
      operation === "revoke"
        ? { certificateId: astro.params.certificateId ?? "" }
        : {}),
    });
    if (astro.request.headers.get("Accept")?.includes("application/json"))
      return certificateJson(result.payload, result.status);
    astro.response.status = result.status;
    feedback.success = result.payload.ok;
    feedback.message = result.payload.message;
    if (!result.payload.ok) feedback.issues = result.payload.issues;
    return feedback;
  } catch (error) {
    const failure = certificateFailure(error);
    if (astro.request.headers.get("Accept")?.includes("application/json"))
      return certificateJson(failure.payload, failure.status);
    astro.response.status = failure.status;
    return {
      ...feedback,
      message: failure.payload.message,
      issues: failure.payload.issues,
    };
  }
}
export function setCertificateHeaders(astro: AstroGlobal) {
  for (const [key, value] of Object.entries(certificateHeaders))
    astro.response.headers.set(key, value);
}
export function certificateMethodNotAllowed(allow = "GET, POST") {
  return new Response(null, {
    status: 405,
    headers: { ...certificateHeaders, Allow: allow },
  });
}
export async function certificateDownloadRoute(
  context: APIContext,
  purpose: "UNSIGNED" | "SIGNED",
) {
  return downloadCertificate({
    actor: requireInternalUser(context.locals),
    certificateId: context.params.certificateId ?? "",
    purpose,
    service: getCertificateService(),
  });
}
export async function certificateUploadRoute(context: APIContext) {
  const result = await handleCertificateUpload({
    request: context.request,
    actor: requireInternalUser(context.locals),
    siteUrl: getPublicAuthEnvironment().siteUrl,
    certificateId: context.params.certificateId ?? "",
    service: getCertificateService(),
  });
  if (context.request.headers.get("Accept")?.includes("application/json"))
    return certificateJson(result.payload, result.status);
  if (result.payload.ok)
    return context.redirect(
      `/app/certificados/${context.params.certificateId}`,
      303,
    );
  // No file bytes or storage references are returned in recoverable HTML errors.
  return new Response(result.payload.message, {
    status: result.status,
    headers: {
      ...certificateHeaders,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
