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
export function freezeCertificateData(input: {
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
}): CertificateTemplateData {
  validateCertificateConfiguration(input.configuration, true, input.type);
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
