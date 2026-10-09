import type { ClosureReportDto } from "@/domain/academic-closure/types";
import type {
  CertificateConfiguration,
  CertificateState,
  CertificateTemplateData,
  CertificateType,
  PublicCertificateDto,
} from "./types";

export class CertificateError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "VALIDATION_FAILED"
      | "CONCURRENT_UPDATE"
      | "IDEMPOTENCY_CONFLICT"
      | "STALE_CLOSURE"
      | "NOT_ELIGIBLE"
      | "INVALID_STATE"
      | "ACTIVE_CERTIFICATE_EXISTS"
      | "CONFIGURATION_REQUIRED",
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "CertificateError";
  }
}
export function certificateId(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    throw new CertificateError("VALIDATION_FAILED", "Identificador no válido.");
}
export function certificateText(value: string, field: string, max = 500) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw new CertificateError(
      "VALIDATION_FAILED",
      "Completa los datos obligatorios.",
      { [field]: "Valor obligatorio o no válido." },
    );
  return value.trim();
}
export const defaultCertificateConfiguration: CertificateConfiguration = {
  director: {
    name: "",
    role: "DIRECTOR ACADÉMICO",
    affiliation: "FCyT - UMSS",
  },
  dean: { name: "", role: "DECANO", affiliation: "FCyT - UMSS" },
  departmentHead: {
    name: "",
    role: "JEFE DEPARTAMENTO",
    affiliation: "INFORMATICA Y SISTEMAS",
  },
  approvalInstructor: {
    role: "INSTRUCTOR",
    affiliation: "DPTO. INFORMATICA-SISTEMAS",
  },
  organization: "Universidad Mayor de San Simón",
  city: "Cochabamba",
  venue:
    "Laboratorio de Cómputo, Departamento de Informática y Sistemas de la Facultad de Ciencias y Tecnología",
  templateVersion: "phase9-v1",
  brandingVersion: "phase9-v1",
};
export function validateCertificateConfiguration(
  config: CertificateConfiguration,
  complete = false,
  type?: CertificateType,
) {
  for (const key of [
    "organization",
    "city",
    "venue",
    "templateVersion",
    "brandingVersion",
  ] as const)
    certificateText(config[key], key);
  for (const key of ["director", "dean", "departmentHead"] as const) {
    const value = config[key];
    certificateText(value.role, `${key}.role`);
    certificateText(value.affiliation, `${key}.affiliation`);
    if (
      value.name ||
      (complete && (key !== "departmentHead" || type === "INSTRUCTOR"))
    ) {
      if (!value.name.trim())
        throw new CertificateError(
          "CONFIGURATION_REQUIRED",
          "Configura los nombres de autoridades antes de generar.",
          { [`${key}.name`]: "Nombre requerido." },
        );
      certificateText(value.name, `${key}.name`);
    }
  }
  certificateText(config.approvalInstructor.role, "approvalInstructor.role");
  certificateText(
    config.approvalInstructor.affiliation,
    "approvalInstructor.affiliation",
  );
}
export function certificateRecipients(
  report: ClosureReportDto,
  type: CertificateType,
) {
  if (!report.instructorId || !report.instructorName?.trim())
    throw new CertificateError(
      "NOT_ELIGIBLE",
      "El cierre no conserva instructor válido.",
    );
  if (type === "INSTRUCTOR")
    return [
      {
        id: report.instructorId,
        name: certificateText(report.instructorName, "instructorName"),
      },
    ];
  if (type !== "APPROVAL")
    throw new CertificateError("VALIDATION_FAILED", "Tipo no válido.");
  return report.participants
    .filter((p) => p.membershipStatus === "INSCRITO" && p.academicallyPassed)
    .map((p) => ({
      id: p.participantId,
      name: certificateText(`${p.firstName} ${p.lastName}`, "recipientName"),
    }));
}
export function requireCurrentClosure(
  closed: boolean,
  currentVersion: number,
  version: number,
) {
  if (!closed || currentVersion !== version)
    throw new CertificateError(
      "STALE_CLOSURE",
      "Solo se permite la última versión oficial del grupo cerrado.",
    );
}
export function publicCertificate(
  state: CertificateState,
  data: CertificateTemplateData,
  signedSha256: string | null,
): PublicCertificateDto {
  if (state !== "issued" && state !== "revoked" && state !== "replaced")
    return { state: "not_issued", valid: false };
  if (!signedSha256) throw new Error("Issued certificate hash unavailable");
  return {
    state,
    valid: state === "issued",
    recipientName: data.recipientName,
    courseName: data.courseName,
    academicHours: data.academicHours,
    type: data.type,
    endsOn: data.endsOn,
    publicCredentialId: data.publicCredentialId,
    verificationUrl: data.verificationUrl,
    organization: data.organization,
    signedSha256,
  };
}
