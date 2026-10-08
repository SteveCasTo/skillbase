export type CertificateType = "APPROVAL" | "INSTRUCTOR";
export type CertificateState =
  | "pending"
  | "generated"
  | "awaiting_signature"
  | "issued"
  | "revoked"
  | "replaced";
export interface CertificateSignatory {
  readonly name: string;
  readonly role: string;
  readonly affiliation: string;
}
export interface CertificateTemplateData {
  readonly type: CertificateType;
  readonly publicCredentialId: string;
  readonly verificationUrl: string;
  readonly recipientName: string;
  readonly courseName: string;
  readonly instructorName: string;
  /** Bolivia civil dates, YYYY-MM-DD. */
  readonly startsOn: string;
  readonly endsOn: string;
  readonly academicHours: number;
  readonly groupNumber: number;
  /** Bolivia civil times, HH:mm. */
  readonly groupStartsAt: string;
  readonly groupEndsAt: string;
  readonly city: string;
  readonly printedMonth: number;
  readonly printedYear: number;
  readonly signatories: readonly [
    CertificateSignatory,
    CertificateSignatory,
    CertificateSignatory,
  ];
  readonly templateVersion: string;
  /** Frozen generation request instant, used only for deterministic unsigned PDF metadata. */
  readonly generatedAt: string;
  readonly organization: string;
  readonly venue: string;
  readonly brandingVersion: string;
}
export interface CertificateConfiguration {
  director: CertificateSignatory;
  dean: CertificateSignatory;
  departmentHead: CertificateSignatory;
  approvalInstructor: Omit<CertificateSignatory, "name">;
  organization: string;
  venue: string;
  city: string;
  templateVersion: string;
  brandingVersion: string;
}
export interface CertificateDto {
  id: string;
  courseId: string;
  groupId: string;
  versionId: string;
  version: number;
  type: CertificateType;
  state: CertificateState;
  revision: number;
  publicCredentialId: string;
  data: CertificateTemplateData;
  obsolete: boolean;
  hasUnsignedPdf: boolean;
  hasSignedPdf: boolean;
  signedSha256: string | null;
  reviewed: boolean;
  generatedAt: string | null;
  issuedAt: string | null;
  revokedAt: string | null;
  reason: string | null;
  replacementForId: string | null;
  replacedById: string | null;
}
export type PublicCertificateDto =
  | { state: "not_found" | "not_issued"; valid: false }
  | {
      state: "issued" | "revoked" | "replaced";
      valid: boolean;
      recipientName: string;
      courseName: string;
      academicHours: number;
      type: CertificateType;
      endsOn: string;
      publicCredentialId: string;
      verificationUrl: string;
      organization: string;
      signedSha256: string;
    };
export interface CertificateCommand {
  certificateId: string;
  revision: number;
  requestKey: string;
}
export interface GenerateCertificatesInput {
  courseId: string;
  groupId: string;
  versionId: string;
  closureRevision: number;
  configurationRevision: number;
  requestKey: string;
  type: CertificateType;
  /** null means all eligible snapshot recipients, atomically. */
  recipientId: string | null;
  groupNumber?: number;
  replacementForId?: string;
  reason?: string;
}
export interface CertificateProvenance {
  configurationRevision: number;
  courseRevision: string;
  groupRevision: string;
  courseTypeRevisionId: string;
  versionId: string;
  instructorId: string;
  courseStartsAt: string;
  courseEndsAt: string;
  groupStartsAt: string;
  groupEndsAt: string;
  academicHours: number;
  groupNumber: number;
}
export interface CertificateEventDto {
  id: string;
  certificateId: string;
  actorId: string;
  actorName: string;
  action: string;
  reason: string | null;
  createdAt: string;
}
