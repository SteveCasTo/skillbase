import type { InternalUser } from "@/domain/auth/types";
import type { CertificateRepository } from "@/application/certificates/repository";
import { CertificateError } from "@/domain/certificates/rules";
import { certificatePreviewData } from "@/domain/certificates/metadata";
import {
  certificateHeaders,
  certificateFailure,
  certificateJson,
  requireCertificateActor,
} from "./http";
import { certificatePdfInput } from "./renderer";
import { renderCertificatePdf } from "./pdf";

/** Read-only composition deliberately has no emission service or Storage dependency. */
export async function previewCertificate(
  actor: InternalUser,
  type: string | null,
  repository: Pick<CertificateRepository, "getSettings">,
) {
  try {
    requireCertificateActor(actor);
    if (type !== "APPROVAL" && type !== "INSTRUCTOR")
      throw new CertificateError("VALIDATION_FAILED", "Tipo no válido.");
    const { configuration } = await repository.getSettings(actor.id);
    const bytes = await renderCertificatePdf(
      certificatePdfInput(certificatePreviewData(configuration, type)),
      { preview: true },
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...certificateHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="vista-previa.pdf"',
      },
    });
  } catch (error) {
    const failure = certificateFailure(error);
    return certificateJson(failure.payload, failure.status);
  }
}
