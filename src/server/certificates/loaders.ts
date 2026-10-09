import type { InternalUser } from "@/domain/auth/types";
import type { CertificateRepository } from "@/application/certificates/repository";
import { certificateFailure, requireCertificateActor } from "./http";
import { getCertificateRepository } from "./service";
export async function loadCertificates(input: {
  actor: InternalUser;
  courseId: string;
  groupId: string;
  repository?: CertificateRepository;
}) {
  try {
    requireCertificateActor(input.actor, false);
    return {
      available: true as const,
      data: await (input.repository ?? getCertificateRepository()).list(
        input.actor.id,
        input.courseId,
        input.groupId,
      ),
    };
  } catch (error) {
    const failure = certificateFailure(error);
    return {
      available: false as const,
      status: failure.status,
      code: failure.payload.code,
      unavailableReason: failure.payload.message,
    };
  }
}
export async function loadCertificate(input: {
  actor: InternalUser;
  id: string;
  repository?: CertificateRepository;
}) {
  try {
    requireCertificateActor(input.actor, false);
    return {
      available: true as const,
      data: await (input.repository ?? getCertificateRepository()).get(
        input.actor.id,
        input.id,
      ),
    };
  } catch (error) {
    const failure = certificateFailure(error);
    return {
      available: false as const,
      status: failure.status,
      code: failure.payload.code,
      unavailableReason: failure.payload.message,
    };
  }
}
export async function loadPublicCertificate(
  publicCredentialId: string,
  repository: CertificateRepository = getCertificateRepository(),
) {
  return repository.verify(publicCredentialId);
}
export async function loadCertificateSettings(input: {
  actor: InternalUser;
  repository?: CertificateRepository;
}) {
  try {
    requireCertificateActor(input.actor);
    return {
      available: true as const,
      data: await (input.repository ?? getCertificateRepository()).getSettings(
        input.actor.id,
      ),
    };
  } catch (error) {
    const failure = certificateFailure(error);
    return {
      available: false as const,
      status: failure.status,
      code: failure.payload.code,
      unavailableReason: failure.payload.message,
    };
  }
}
export async function loadCertificateHistory(input: {
  actor: InternalUser;
  id: string;
  repository?: CertificateRepository;
}) {
  try {
    requireCertificateActor(input.actor);
    return {
      available: true as const,
      data: await (input.repository ?? getCertificateRepository()).history(
        input.actor.id,
        input.id,
      ),
    };
  } catch (error) {
    const failure = certificateFailure(error);
    return {
      available: false as const,
      status: failure.status,
      code: failure.payload.code,
      unavailableReason: failure.payload.message,
    };
  }
}
