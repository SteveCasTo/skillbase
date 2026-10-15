import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import type {
  CertificateConfiguration,
  CertificateTemplateData,
  CertificateType,
} from "./types";
import {
  certificateText,
  CertificateError,
  validateCertificateConfiguration,
} from "./rules";
type CertificateDataInput = {
  type: CertificateType;
  publicCredentialId: string;
  verificationOrigin: string;
  recipientName: string;
  courseName: string;
  instructorName: string;
  courseStartsAt: Date;
  courseEndsAt: Date;
  groupStartsAt: Date;
  groupEndsAt: Date;
  academicHours: number;
  groupNumber: number;
  configuration: CertificateConfiguration;
  generatedAt: Date;
};
export function freezeCertificateData(
  input: CertificateDataInput,
): CertificateTemplateData {
  return composeCertificateData(input, true);
}
// The dot is outside the base64url alphabet used for issued credential IDs.
// Together with the reserved .invalid host, this sample cannot verify a credential.
export const CERTIFICATE_PREVIEW_ID = "S6kN9vQ2.r4Yb8Hc3Lw5Xj7Fp0Tz1DaM";
export const CERTIFICATE_PREVIEW_URL = `https://preview.invalid/certificados/${CERTIFICATE_PREVIEW_ID}`;

/** Non-credential sample, deliberately outside the issued identifier namespace. */
export function certificatePreviewData(
  configuration: CertificateConfiguration,
  type: CertificateType,
): CertificateTemplateData {
  const data = composeCertificateData(
    {
      type,
      configuration,
      publicCredentialId: CERTIFICATE_PREVIEW_ID,
      verificationOrigin: "https://preview.invalid",
      recipientName:
        type === "APPROVAL"
          ? "Nombre del participante"
          : "Nombre del instructor",
      instructorName: "Nombre del instructor",
      courseName: "Nombre del curso",
      courseStartsAt: new Date("2026-07-23T15:30:00Z"),
      courseEndsAt: new Date("2026-08-05T17:00:00Z"),
      groupStartsAt: new Date("2026-07-23T15:30:00Z"),
      groupEndsAt: new Date("2026-08-05T17:00:00Z"),
      academicHours: 20,
      groupNumber: 1,
      generatedAt: new Date("2026-08-05T17:00:00Z"),
    },
    false,
  );
  return data;
}
function composeCertificateData(
  input: CertificateDataInput,
  complete: boolean,
): CertificateTemplateData {
  validateCertificateConfiguration(input.configuration, complete, input.type);
  if (
    !Number.isSafeInteger(input.groupNumber) ||
    input.groupNumber < 1 ||
    !Number.isFinite(input.academicHours) ||
    input.academicHours <= 0
  )
    throw new CertificateError(
      "VALIDATION_FAILED",
      "Horas y número de grupo deben ser positivos.",
    );
  if (
    !(input.courseStartsAt < input.courseEndsAt) ||
    !(input.groupStartsAt < input.groupEndsAt)
  )
    throw new CertificateError(
      "VALIDATION_FAILED",
      "Fechas nominales no válidas.",
    );
  const origin = new URL(input.verificationOrigin);
  if (
    origin.username ||
    origin.password ||
    !["http:", "https:"].includes(origin.protocol) ||
    (origin.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(origin.hostname))
  )
    throw new CertificateError(
      "VALIDATION_FAILED",
      "Origen de verificación no válido.",
    );
  const startsOn = instantToBoliviaCivil(
    input.type === "APPROVAL" ? input.courseStartsAt : input.groupStartsAt,
  ).slice(0, 10);
  const endsOn = instantToBoliviaCivil(
    input.type === "APPROVAL" ? input.courseEndsAt : input.groupEndsAt,
  ).slice(0, 10);
  const c = input.configuration;
  return {
    type: input.type,
    publicCredentialId: input.publicCredentialId,
    verificationUrl: `${origin.origin}/certificados/${input.publicCredentialId}`,
    recipientName: certificateText(input.recipientName, "recipientName"),
    courseName: certificateText(input.courseName, "courseName"),
    instructorName: certificateText(input.instructorName, "instructorName"),
    startsOn,
    endsOn,
    academicHours: input.academicHours,
    groupNumber: input.groupNumber,
    groupStartsAt: instantToBoliviaCivil(input.groupStartsAt).slice(11),
    groupEndsAt: instantToBoliviaCivil(input.groupEndsAt).slice(11),
    city: c.city,
    printedMonth: Number(endsOn.slice(5, 7)),
    printedYear: Number(endsOn.slice(0, 4)),
    signatories: [
      input.type === "APPROVAL"
        ? { name: input.instructorName, ...c.approvalInstructor }
        : { ...c.departmentHead },
      { ...c.director },
      { ...c.dean },
    ],
    templateVersion: c.templateVersion,
    generatedAt: input.generatedAt.toISOString(),
    brandingVersion: c.brandingVersion,
    organization: c.organization,
    venue: c.venue,
  };
}
