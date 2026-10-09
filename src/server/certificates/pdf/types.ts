/** Presentation adapter only. Eligibility, snapshots, issuance and final-file
 * hashing belong to the certificate application/domain, not this renderer. */
export const CERTIFICATE_PDF_TEMPLATE_VERSION = 1;

export interface CertificateSignatory {
  readonly name: string;
  readonly role: string;
  readonly affiliation: string;
}

interface CertificateRenderBase {
  readonly publicCredentialId: string;
  readonly verificationUrl: string;
  readonly recipientName: string;
  readonly courseName: string;
  readonly instructorName: string | null;
  /** Frozen nominal civil dates, never instants or reconstructed session dates. */
  readonly startsOn: string;
  readonly endsOn: string;
  readonly academicHours: number;
  readonly city: string;
  /** Must match the nominal end date; never the emission/current month. */
  readonly printedMonth: number;
  readonly printedYear: number;
  readonly signatories: readonly [
    CertificateSignatory,
    CertificateSignatory,
    CertificateSignatory,
  ];
  readonly templateVersion: number;
  /** Frozen ISO instant used exclusively for deterministic PDF metadata. */
  readonly generatedAt: string;
}

export type CertificateRenderInput = CertificateRenderBase &
  (
    | { readonly type: "APPROVAL" }
    | {
        readonly type: "INSTRUCTOR";
        readonly groupNumber: number;
        readonly groupStartsAt: string;
        readonly groupEndsAt: string;
      }
  );

export type CertificatePdfErrorCode =
  | "PDF_INVALID_INPUT"
  | "PDF_UNSUPPORTED_TEXT"
  | "PDF_TEXT_OVERFLOW"
  | "PDF_TEMPLATE_VERSION_UNSUPPORTED"
  | "PDF_QR_TOO_DENSE";

export class CertificatePdfError extends Error {
  constructor(
    readonly code: CertificatePdfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CertificatePdfError";
  }
}
