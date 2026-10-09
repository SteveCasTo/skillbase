import type { CertificatePdfRenderer } from "@/application/certificates/types";
import type { CertificateTemplateData } from "@/domain/certificates/types";
import {
  CertificateError,
  defaultCertificateConfiguration,
} from "@/domain/certificates/rules";
import { renderCertificatePdf, type CertificateRenderInput } from "./pdf";

/** Maps frozen domain metadata to the normally merged producer's real contract.
 * Application/domain do not import infrastructure types or own a fake renderer. */
export type CertificatePdfV1Input = CertificateRenderInput;
export function certificatePdfInput(
  data: CertificateTemplateData,
): CertificatePdfV1Input {
  if (
    data.templateVersion !== "phase9-v1" ||
    data.brandingVersion !== "phase9-v1" ||
    data.venue !== defaultCertificateConfiguration.venue ||
    data.organization !== defaultCertificateConfiguration.organization
  )
    throw new CertificateError(
      "CONFIGURATION_REQUIRED",
      "La plantilla institucional configurada no está disponible.",
      {
        templateVersion:
          "Selecciona la plantilla institucional v1 y su branding compatible.",
      },
    );
  const base = {
    publicCredentialId: data.publicCredentialId,
    verificationUrl: data.verificationUrl,
    recipientName: data.recipientName,
    courseName: data.courseName,
    instructorName: data.instructorName,
    startsOn: data.startsOn,
    endsOn: data.endsOn,
    academicHours: data.academicHours,
    city: data.city,
    printedMonth: data.printedMonth,
    printedYear: data.printedYear,
    generatedAt: data.generatedAt,
    templateVersion: 1 as const,
    signatories: [
      { ...data.signatories[0] },
      { ...data.signatories[1] },
      { ...data.signatories[2] },
    ] as const,
  };
  switch (data.type) {
    case "APPROVAL":
      return { ...base, type: "APPROVAL" };
    case "INSTRUCTOR":
      return {
        ...base,
        type: "INSTRUCTOR",
        groupNumber: data.groupNumber,
        groupStartsAt: data.groupStartsAt,
        groupEndsAt: data.groupEndsAt,
      };
  }
}
export function createCertificatePdfRenderer(
  render: (
    input: CertificateRenderInput,
  ) => Promise<Uint8Array> = renderCertificatePdf,
): CertificatePdfRenderer {
  return {
    async render(data) {
      try {
        return await render(certificatePdfInput(data));
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          typeof error.code === "string" &&
          [
            "PDF_INVALID_INPUT",
            "PDF_UNSUPPORTED_TEXT",
            "PDF_TEXT_OVERFLOW",
            "PDF_TEMPLATE_VERSION_UNSUPPORTED",
            "PDF_QR_TOO_DENSE",
          ].includes(error.code)
        )
          throw new CertificateError("VALIDATION_FAILED", error.message, {
            document:
              "Revisa los datos de impresión; no se generó un PDF incompleto.",
          });
        throw error;
      }
    },
  };
}
