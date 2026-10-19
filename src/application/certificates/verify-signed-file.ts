import type { CertificateRepository } from "./repository";
import { CertificateError } from "@/domain/certificates/rules";

/** Possession of a complete signed-file digest, never a prefix or PII search. */
export function verifySignedFile(
  repository: Pick<CertificateRepository, "verifySignedHash">,
  sha256: unknown,
) {
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256))
    throw new CertificateError("VALIDATION_FAILED", "Solicitud no válida.");
  return repository.verifySignedHash(sha256);
}
