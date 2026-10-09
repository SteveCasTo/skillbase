import type {
  CertificateCommand,
  CertificateConfiguration,
  CertificateDto,
  CertificateEventDto,
  GenerateCertificatesInput,
  PublicCertificateDto,
} from "@/domain/certificates/types";
export interface ArtifactReservation {
  id: string;
  certificateId: string;
  path: string;
  purpose: "UNSIGNED" | "SIGNED";
  sha256: string;
  certificateRevision: number;
  status: "reserved" | "attached" | "cleanup_pending" | "cleaned";
}
export interface CertificateRepository {
  getSettings(
    actorId: string,
  ): Promise<{ revision: number; configuration: CertificateConfiguration }>;
  updateSettings(
    actorId: string,
    revision: number,
    configuration: CertificateConfiguration,
  ): Promise<{ revision: number; configuration: CertificateConfiguration }>;
  list(
    actorId: string,
    courseId: string,
    groupId: string,
  ): Promise<CertificateDto[]>;
  get(actorId: string, id: string): Promise<CertificateDto>;
  history(actorId: string, id: string): Promise<CertificateEventDto[]>;
  verify(publicCredentialId: string): Promise<PublicCertificateDto>;
  prepare(
    actorId: string,
    input: GenerateCertificatesInput,
    verificationOrigin: string,
  ): Promise<CertificateDto[]>;
  reserveArtifact(
    actorId: string,
    command: CertificateCommand,
    purpose: "UNSIGNED" | "SIGNED",
    sha256: string,
  ): Promise<ArtifactReservation>;
  attachArtifact(
    actorId: string,
    reservation: ArtifactReservation,
  ): Promise<CertificateDto>;
  /** True only when this reservation was atomically claimed for cleanup. */
  abandonArtifact(id: string): Promise<boolean>;
  cleanedArtifact(id: string): Promise<void>;
  cleanupCandidates(
    actorId: string,
    before: Date,
  ): Promise<ArtifactReservation[]>;
  review(actorId: string, command: CertificateCommand): Promise<CertificateDto>;
  issue(actorId: string, command: CertificateCommand): Promise<CertificateDto>;
  revoke(
    actorId: string,
    command: CertificateCommand,
    reason: string,
  ): Promise<CertificateDto>;
  downloadPath(
    actorId: string,
    id: string,
    purpose: "UNSIGNED" | "SIGNED",
  ): Promise<string>;
}
