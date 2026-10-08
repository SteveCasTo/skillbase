import {
  CERTIFICATE_PDF_TEMPLATE_VERSION,
  CertificatePdfError,
  type CertificateRenderInput,
} from "./types";

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

function civilDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const date = new Date(`${value}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    invalid();
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: value.slice(8),
  };
}

function invalid(): never {
  throw new CertificatePdfError(
    "PDF_INVALID_INPUT",
    "Los datos congelados del certificado no son válidos.",
  );
}

function text(value: string, maximum = 1024) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return (code < 32 && code !== 10) || code === 127;
    })
  )
    invalid();
}

export function validateCertificateRenderInput(input: CertificateRenderInput) {
  if (input.templateVersion !== CERTIFICATE_PDF_TEMPLATE_VERSION)
    throw new CertificatePdfError(
      "PDF_TEMPLATE_VERSION_UNSUPPORTED",
      "La versión de plantilla no está disponible.",
    );
  if (input.type !== "APPROVAL" && input.type !== "INSTRUCTOR") invalid();
  for (const value of [input.recipientName, input.courseName, input.city])
    text(value);
  if (input.instructorName !== null) text(input.instructorName);
  if (!/^[A-Za-z0-9_-]{22,128}$/.test(input.publicCredentialId)) invalid();
  if (input.verificationUrl.length > 512) invalid();
  let url: URL;
  try {
    url = new URL(input.verificationUrl);
  } catch {
    invalid();
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/certificados/${input.publicCredentialId}`
  )
    invalid();
  const start = civilDate(input.startsOn);
  const end = civilDate(input.endsOn);
  if (
    input.startsOn > input.endsOn ||
    input.printedMonth !== end.month ||
    input.printedYear !== end.year
  )
    invalid();
  if (
    !Number.isFinite(input.academicHours) ||
    input.academicHours <= 0 ||
    input.academicHours > 10000 ||
    input.academicHours !== Number(input.academicHours.toFixed(2))
  )
    invalid();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      input.generatedAt,
    ) ||
    !Number.isFinite(Date.parse(input.generatedAt))
  )
    invalid();
  if (!Array.isArray(input.signatories) || input.signatories.length !== 3)
    invalid();
  for (const signer of input.signatories) {
    text(signer.name, 300);
    text(signer.role, 300);
    text(signer.affiliation, 300);
  }
  if (input.type === "INSTRUCTOR") {
    if (
      !Number.isSafeInteger(input.groupNumber) ||
      input.groupNumber < 1 ||
      input.groupNumber > 9999
    )
      invalid();
    const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (
      !time.test(input.groupStartsAt) ||
      !time.test(input.groupEndsAt) ||
      input.groupStartsAt >= input.groupEndsAt
    )
      invalid();
  }
  return { start, end };
}

export function certificateDocument(input: CertificateRenderInput) {
  const { start, end } = validateCertificateRenderInput(input);
  const firstYear = start.year !== end.year ? ` de ${start.year}` : "";
  const range = `${start.day} de ${MONTHS[start.month - 1]}${firstYear} al ${end.day} de ${MONTHS[end.month - 1]} de ${end.year}`;
  const group =
    input.type === "INSTRUCTOR"
      ? `GRUPO ${input.groupNumber}, en horario de ${input.groupStartsAt} a ${input.groupEndsAt}, realizado`
      : "Realizado";
  const hours = new Intl.NumberFormat("es-BO", {
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(input.academicHours);
  return {
    title:
      input.type === "APPROVAL"
        ? "Certificado de aprobación"
        : "Certificado de instructor",
    introduction:
      input.type === "APPROVAL"
        ? "Por haber completado satisfactoriamente el curso intensivo de :"
        : "Por haber IMPARTIDO el curso intensivo de:",
    course:
      input.type === "INSTRUCTOR"
        ? input.courseName.toLocaleUpperCase("es-BO")
        : input.courseName,
    body: `${group} en los ambientes del Laboratorio de Cómputo, Departamento de Informática y Sistemas de la Facultad de Ciencias y Tecnología, del ${range}, con una duración de ${hours} horas académicas.`,
    date: `${input.city}, ${MONTHS[end.month - 1]} ${end.year}`,
  };
}
