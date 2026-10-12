import type { CertificateRepository } from "./repository";
import {
  CertificateError,
  validateCertificateConfiguration,
} from "@/domain/certificates/rules";
import type { CertificateConfiguration } from "@/domain/certificates/types";

export const certificateSettingsFields = [
  "departmentHead.name",
  "departmentHead.role",
  "departmentHead.affiliation",
  "director.name",
  "director.role",
  "director.affiliation",
  "dean.name",
  "dean.role",
  "dean.affiliation",
  "approvalInstructor.role",
  "approvalInstructor.affiliation",
] as const;
export type CertificateSettingsField =
  (typeof certificateSettingsFields)[number];
export function certificateSettingsValue(
  configuration: CertificateConfiguration,
  field: CertificateSettingsField,
): string {
  const [position, property] = field.split(".");
  const signer =
    configuration[
      position as "director" | "dean" | "departmentHead" | "approvalInstructor"
    ];
  return signer[property as keyof typeof signer];
}

/** Server-read merge plus repository CAS: a racing writer cannot be overwritten. */
export async function updateCertificateSettingsField(
  repository: Pick<CertificateRepository, "getSettings" | "updateSettings">,
  actorId: string,
  revision: number,
  field: string,
  value: string,
) {
  if (!certificateSettingsFields.includes(field as CertificateSettingsField))
    throw new CertificateError("VALIDATION_FAILED", "Campo no admitido.");
  const current = await repository.getSettings(actorId);
  if (current.revision !== revision)
    throw new CertificateError(
      "CONCURRENT_UPDATE",
      "La configuración cambió. Recarga los valores vigentes antes de guardar.",
    );
  const configuration = structuredClone(current.configuration);
  const [position, property] = field.split(".");
  const signer =
    configuration[
      position as "director" | "dean" | "departmentHead" | "approvalInstructor"
    ];
  Object.assign(signer, { [property!]: value });
  validateCertificateConfiguration(configuration);
  Object.assign(signer, { [property!]: value.trim() });
  return repository.updateSettings(actorId, revision, configuration);
}
