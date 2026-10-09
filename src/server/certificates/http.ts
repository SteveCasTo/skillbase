import type { InternalUser } from "@/domain/auth/types";
import type { CertificateRepository } from "@/application/certificates/repository";
import type { ManageCertificates } from "@/application/certificates/manage-certificates";
import { CertificateError } from "@/domain/certificates/rules";
import type { CertificateConfiguration } from "@/domain/certificates/types";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { readInterestRequest } from "@/server/interests/request";
import { InterestError } from "@/domain/interests/rules";
import { CERTIFICATE_PDF_MAX_BYTES, validateCertificatePdf } from "./upload";

export const certificateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function certificateJson(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...certificateHeaders, "Content-Type": "application/json" },
  });
}
export function requireCertificateActor(actor: InternalUser, adminOnly = true) {
  if (
    !actor.authUserId ||
    actor.status !== "ACTIVE" ||
    (!actor.roles.includes("ADMIN") &&
      (adminOnly || !actor.roles.includes("INSTRUCTOR")))
  )
    throw new CertificateError(
      "FORBIDDEN",
      "La cuenta no tiene autorización vigente.",
    );
}
export function certificateFailure(error: unknown) {
  if (error instanceof CertificateError)
    return {
      status:
        error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND"
            ? 404
            : [
                  "CONCURRENT_UPDATE",
                  "IDEMPOTENCY_CONFLICT",
                  "STALE_CLOSURE",
                  "INVALID_STATE",
                  "ACTIVE_CERTIFICATE_EXISTS",
                ].includes(error.code)
              ? 409
              : 422,
      payload: {
        ok: false as const,
        code: error.code,
        message: error.message,
        issues: error.fields,
      },
    };
  if (error instanceof InterestError)
    return {
      status: error.status,
      payload: {
        ok: false as const,
        code: error.code,
        message: error.message,
        issues: {},
      },
    };
  return {
    status: 503,
    payload: {
      ok: false as const,
      code: "SERVICE_UNAVAILABLE",
      message: "No se pudo confirmar la operación.",
      issues: {},
    },
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CertificateError("VALIDATION_FAILED", "Solicitud no válida.");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string")
    throw new CertificateError(
      "VALIDATION_FAILED",
      "Campo de texto requerido.",
    );
  return value;
}
function number(value: unknown): number {
  const n =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)
    throw new CertificateError("VALIDATION_FAILED", "Revisión no válida.");
  return n;
}
function allow(raw: Record<string, unknown>, fields: string[]) {
  if (Object.keys(raw).some((k) => !fields.includes(k)))
    throw new CertificateError("VALIDATION_FAILED", "Campos no admitidos.");
}
function configuration(value: unknown): CertificateConfiguration {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new CertificateError(
        "VALIDATION_FAILED",
        "Configuración JSON no válida.",
      );
    }
  }
  const r = object(parsed);
  allow(r, [
    "director",
    "dean",
    "departmentHead",
    "approvalInstructor",
    "organization",
    "venue",
    "city",
    "templateVersion",
    "brandingVersion",
  ]);
  const authority = (v: unknown) => {
    const a = object(v);
    allow(a, ["name", "role", "affiliation"]);
    return {
      name: text(a.name),
      role: text(a.role),
      affiliation: text(a.affiliation),
    };
  };
  const instructor = object(r.approvalInstructor);
  allow(instructor, ["role", "affiliation"]);
  return {
    director: authority(r.director),
    dean: authority(r.dean),
    departmentHead: authority(r.departmentHead),
    approvalInstructor: {
      role: text(instructor.role),
      affiliation: text(instructor.affiliation),
    },
    organization: text(r.organization),
    venue: text(r.venue),
    city: text(r.city),
    templateVersion: text(r.templateVersion),
    brandingVersion: text(r.brandingVersion),
  };
}
export async function handleCertificatePost(input: {
  request: Request;
  actor: InternalUser;
  siteUrl: URL;
  repository: CertificateRepository;
  service?: ManageCertificates;
  operation: "generate" | "review" | "issue" | "revoke" | "settings";
  certificateId?: string;
  courseId?: string;
  groupId?: string;
}) {
  try {
    requireCertificateActor(input.actor);
    if (!requestHasExpectedOrigin(input.request, input.siteUrl))
      throw new CertificateError("FORBIDDEN", "Origen no válido.");
    const raw = object(await readInterestRequest(input.request, 65536));
    const actorId = input.actor.id;
    let value: unknown;
    if (input.operation === "settings") {
      allow(raw, ["revision", "configuration"]);
      value = await input.repository.updateSettings(
        actorId,
        number(raw.revision),
        configuration(raw.configuration),
      );
    } else if (input.operation === "generate") {
      allow(raw, [
        "requestKey",
        "versionId",
        "closureRevision",
        "configurationRevision",
        "type",
        "recipientId",
        "groupNumber",
        "replacementForId",
        "reason",
      ]);
      const type = text(raw.type);
      if (type !== "APPROVAL" && type !== "INSTRUCTOR")
        throw new CertificateError("VALIDATION_FAILED", "Tipo no válido.");
      if (!input.service || !input.courseId || !input.groupId)
        throw new Error("Generation adapter not composed");
      value = await input.service.generate(actorId, {
        courseId: input.courseId,
        groupId: input.groupId,
        requestKey: text(raw.requestKey),
        versionId: text(raw.versionId),
        closureRevision: number(raw.closureRevision),
        configurationRevision: number(raw.configurationRevision),
        type,
        recipientId:
          raw.recipientId == null || raw.recipientId === ""
            ? null
            : text(raw.recipientId),
        ...(raw.groupNumber !== undefined
          ? { groupNumber: number(raw.groupNumber) }
          : {}),
        ...(raw.replacementForId
          ? {
              replacementForId: text(raw.replacementForId),
              reason: text(raw.reason),
            }
          : {}),
      });
    } else {
      allow(raw, [
        "requestKey",
        "revision",
        ...(input.operation === "revoke" ? ["reason"] : []),
      ]);
      if (!input.certificateId)
        throw new Error("Certificate route context missing");
      const command = {
        certificateId: input.certificateId,
        requestKey: text(raw.requestKey),
        revision: number(raw.revision),
      };
      value =
        input.operation === "review"
          ? await input.repository.review(actorId, command)
          : input.operation === "issue"
            ? await input.repository.issue(actorId, command)
            : await input.repository.revoke(actorId, command, text(raw.reason));
    }
    return {
      status: 200,
      payload: {
        ok: true as const,
        value,
        message: "Operación de certificado confirmada.",
      },
    };
  } catch (error) {
    return certificateFailure(error);
  }
}
async function boundedMultipart(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data;"))
    throw new CertificateError(
      "VALIDATION_FAILED",
      "Carga multipart requerida.",
    );
  const max = CERTIFICATE_PDF_MAX_BYTES + 65536;
  if (Number(request.headers.get("content-length")) > max || !request.body)
    throw new CertificateError("VALIDATION_FAILED", "Carga demasiado grande.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new CertificateError(
          "VALIDATION_FAILED",
          "Carga demasiado grande.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return await new Response(bytes, {
      headers: { "Content-Type": type },
    }).formData();
  } catch {
    throw new CertificateError(
      "VALIDATION_FAILED",
      "Carga multipart no válida.",
    );
  }
}
export async function handleCertificateUpload(input: {
  request: Request;
  actor: InternalUser;
  siteUrl: URL;
  certificateId: string;
  service: ManageCertificates;
}) {
  try {
    requireCertificateActor(input.actor);
    if (!requestHasExpectedOrigin(input.request, input.siteUrl))
      throw new CertificateError("FORBIDDEN", "Origen no válido.");
    const form = await boundedMultipart(input.request);
    if (
      [...form.keys()].some(
        (k) => !["file", "revision", "requestKey", "purpose"].includes(k),
      ) ||
      [...new Set(form.keys())].some((k) => form.getAll(k).length !== 1)
    )
      throw new CertificateError(
        "VALIDATION_FAILED",
        "Campos duplicados o no admitidos.",
      );
    const file = form.get("file");
    if (!(file instanceof File) || form.get("purpose") !== "SIGNED")
      throw new CertificateError(
        "VALIDATION_FAILED",
        "PDF final firmado requerido.",
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    await validateCertificatePdf(bytes, file.name, file.type, "SIGNED");
    const value = await input.service.uploadSigned(
      input.actor.id,
      {
        certificateId: input.certificateId,
        revision: number(form.get("revision")),
        requestKey: text(form.get("requestKey")),
      },
      bytes,
    );
    return {
      status: 200,
      payload: {
        ok: true as const,
        value,
        message: "PDF firmado cargado; pendiente de revisión ADMIN.",
      },
    };
  } catch (error) {
    return certificateFailure(error);
  }
}
export async function downloadCertificate(input: {
  actor: InternalUser;
  certificateId: string;
  purpose: "SIGNED" | "UNSIGNED";
  service: ManageCertificates;
}) {
  try {
    requireCertificateActor(input.actor, false);
    const bytes = await input.service.download(
      input.actor.id,
      input.certificateId,
      input.purpose,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...certificateHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="certificate-${input.purpose.toLowerCase()}.pdf"`,
      },
    });
  } catch (error) {
    const f = certificateFailure(error);
    return certificateJson(f.payload, f.status);
  }
}
