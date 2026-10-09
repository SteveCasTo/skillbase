import type {
  CertificateState,
  CertificateType,
  PublicCertificateDto,
} from "@/domain/certificates/types";

export const certificateStateLabel: Record<CertificateState, string> = {
  pending: "Pendiente de generar",
  generated: "PDF generado",
  awaiting_signature: "Pendiente de emisión",
  issued: "Emitido",
  revoked: "Revocado",
  replaced: "Reemplazado",
};
export const certificateTypeLabel: Record<CertificateType, string> = {
  APPROVAL: "Certificado de aprobación",
  INSTRUCTOR: "Certificado de instructor",
};
export const publicStateLabel = {
  issued: "Certificado vigente",
  revoked: "Certificado revocado",
  replaced: "Certificado reemplazado",
  not_found: "Certificado no disponible",
  not_issued: "Certificado no emitido",
} satisfies Record<PublicCertificateDto["state"], string>;

export function civilDateLabel(value: string) {
  return new Intl.DateTimeFormat("es-BO", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}
export const certificateEventLabel: Readonly<Record<string, string>> = {
  PREPARED: "Documento preparado",
  GENERATED: "PDF generado",
  SIGNED_PDF_UPLOADED: "PDF firmado cargado",
  REVIEW: "Revisión confirmada",
  ISSUE: "Certificado emitido",
  REVOKE: "Certificado revocado",
  REPLACED: "Certificado reemplazado",
};
export function instantLabel(value: string) {
  return new Intl.DateTimeFormat("es-BO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/La_Paz",
  }).format(new Date(value));
}
export function validCredentialCode(value: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/u.test(value);
}

/** Narrow the actual HTTP allowlist, never a private record or raw snapshot. */
export function isPublicCertificateDto(
  value: unknown,
): value is PublicCertificateDto {
  if (!value || typeof value !== "object") return false;
  if (!("state" in value) || !("valid" in value)) return false;
  if (value.state === "not_found" || value.state === "not_issued")
    return value.valid === false;
  if (!["issued", "revoked", "replaced"].includes(String(value.state)))
    return false;
  return (
    value.valid === (value.state === "issued") &&
    "recipientName" in value &&
    typeof value.recipientName === "string" &&
    "courseName" in value &&
    typeof value.courseName === "string" &&
    "academicHours" in value &&
    typeof value.academicHours === "number" &&
    "type" in value &&
    (value.type === "APPROVAL" || value.type === "INSTRUCTOR") &&
    "endsOn" in value &&
    typeof value.endsOn === "string" &&
    "publicCredentialId" in value &&
    typeof value.publicCredentialId === "string" &&
    validCredentialCode(value.publicCredentialId) &&
    "verificationUrl" in value &&
    typeof value.verificationUrl === "string" &&
    "organization" in value &&
    typeof value.organization === "string" &&
    "signedSha256" in value &&
    typeof value.signedSha256 === "string" &&
    /^[a-f0-9]{64}$/iu.test(value.signedSha256)
  );
}
