import { createHash, randomUUID } from "node:crypto";
import type { CertificateRepository } from "./repository";
import type { CertificatePdfRenderer, CertificateStorage } from "./types";
import type {
  CertificateCommand,
  GenerateCertificatesInput,
} from "@/domain/certificates/types";

/** Storage and renderer I/O never run inside the repository transaction. */
export class ManageCertificates {
  constructor(
    private readonly repository: CertificateRepository,
    private readonly storage: CertificateStorage,
    private readonly renderer: CertificatePdfRenderer,
    private readonly verificationOrigin: string,
  ) {}
  async generate(actorId: string, input: GenerateCertificatesInput) {
    const rows = await this.repository.prepare(
      actorId,
      input,
      this.verificationOrigin,
    );
    const result = [];
    for (const row of rows) {
      if (row.hasUnsignedPdf) {
        result.push(row);
        continue;
      }
      const bytes = await this.renderer.render(row.data);
      result.push(
        await this.store(
          actorId,
          {
            certificateId: row.id,
            revision: row.revision,
            requestKey: randomUUID(),
          },
          "UNSIGNED",
          bytes,
        ),
      );
    }
    return result;
  }
  /** Caller validates server-side PDF content/size/purpose before entering use case. */
  async uploadSigned(
    actorId: string,
    command: CertificateCommand,
    bytes: Uint8Array,
  ) {
    return this.store(actorId, command, "SIGNED", bytes);
  }
  private async store(
    actorId: string,
    command: CertificateCommand,
    purpose: "SIGNED" | "UNSIGNED",
    bytes: Uint8Array,
  ) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const reservation = await this.repository.reserveArtifact(
      actorId,
      command,
      purpose,
      sha256,
    );
    if (reservation.status === "attached")
      return this.repository.get(actorId, command.certificateId);
    if (reservation.status !== "reserved")
      throw new Error("Artifact reservation abandoned; use a new request key");
    try {
      await this.storage.put(reservation.path, bytes);
      return await this.repository.attachArtifact(actorId, reservation);
    } catch (error) {
      // Mark before deleting; a failed deletion leaves a durable outbox item.
      const claimed = await this.repository.abandonArtifact(reservation.id);
      if (claimed) {
        try {
          await this.storage.remove(reservation.path);
          await this.repository.cleanedArtifact(reservation.id);
        } catch {
          /* durable cleanup_pending, original artifacts untouched */
        }
      }
      throw error;
    }
  }
  async download(actorId: string, id: string, purpose: "SIGNED" | "UNSIGNED") {
    const path = await this.repository.downloadPath(actorId, id, purpose);
    return this.storage.get(path);
  }
  async cleanup(actorId: string, before: Date) {
    // Reservations have a bounded I/O window; only explicitly expired ones are reclaimed.
    if (before.getTime() > Date.now() - 60 * 60 * 1000)
      throw new Error("Cleanup cutoff must be at least one hour old");
    const candidates = await this.repository.cleanupCandidates(actorId, before);
    for (const artifact of candidates) {
      await this.storage.remove(artifact.path);
      await this.repository.cleanedArtifact(artifact.id);
    }
    return candidates.length;
  }
}
