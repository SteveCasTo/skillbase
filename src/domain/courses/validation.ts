import { CourseDomainError } from "./errors";
import { boliviaCivilToInstant } from "./bolivia-time";
import { COURSE_LEVELS, type CourseData, type CourseLevel } from "./types";

export type CourseInput = Readonly<Record<string, string | undefined>>;

function requiredText(
  input: CourseInput,
  key: string,
  label: string,
  errors: Record<string, string>,
): string {
  const value = input[key]?.trim() ?? "";
  if (!value) errors[key] = `${label} es obligatorio.`;
  return value;
}

function validateTextControls(
  input: CourseInput,
  key: string,
  multiline: boolean,
  errors: Record<string, string>,
): void {
  // Text entry rejects control characters; multiline fields retain newline and tab.
  const pattern = multiline
    ? // eslint-disable-next-line no-control-regex
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u
    : // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f]/u;
  if (pattern.test(input[key] ?? ""))
    errors[key] = "El campo contiene caracteres no permitidos.";
}

function dateValue(
  input: CourseInput,
  key: string,
  label: string,
  errors: Record<string, string>,
): Date {
  const raw = input[key] ?? "";
  let date = new Date(Number.NaN);
  try {
    date = boliviaCivilToInstant(raw);
  } catch {
    errors[key] = `${label} debe ser una fecha válida.`;
  }
  return date;
}

function optionalDate(
  input: CourseInput,
  key: string,
  errors: Record<string, string>,
): Date | null {
  const raw = input[key] ?? "";
  if (!raw) return null;
  let date = new Date(Number.NaN);
  try {
    date = boliviaCivilToInstant(raw);
  } catch {
    errors[key] = "La fecha debe ser una fecha civil válida de Bolivia.";
  }
  return date;
}

export function money(
  input: CourseInput,
  key: string,
  errors: Record<string, string>,
): string {
  const raw = input[key]?.trim() ?? "";
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(raw)) {
    errors[key] = "Ingresa un monto no negativo con hasta 2 decimales.";
    return raw;
  }
  const [whole, fraction = ""] = raw.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

export function validateCourseData(input: CourseInput): CourseData {
  const errors: Record<string, string> = {};
  const name = requiredText(input, "name", "El nombre", errors);
  const description = requiredText(
    input,
    "description",
    "La descripción",
    errors,
  );
  const schedule = requiredText(input, "schedule", "El horario", errors);
  const conditions = requiredText(
    input,
    "conditions",
    "Las condiciones",
    errors,
  );
  validateTextControls(input, "name", false, errors);
  validateTextControls(input, "description", true, errors);
  validateTextControls(input, "schedule", false, errors);
  validateTextControls(input, "conditions", true, errors);
  validateTextControls(input, "instructorName", false, errors);
  validateTextControls(input, "contentMarkdown", true, errors);
  const levelRaw = input.level ?? "";
  if (!COURSE_LEVELS.some((level) => level === levelRaw))
    errors.level = "Selecciona un nivel válido.";
  const courseTypeId = input.courseTypeId?.trim() ?? "";
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(courseTypeId))
    errors.courseTypeId = "Selecciona un formato válido.";
  const minimumGradeRaw = input.minimumGrade?.trim() ?? "";
  const minimumGrade = Number(minimumGradeRaw);
  if (
    !/^\d+$/.test(minimumGradeRaw) ||
    !Number.isInteger(minimumGrade) ||
    minimumGrade < 0 ||
    minimumGrade > 100
  )
    errors.minimumGrade = "La nota mínima debe estar entre 0 y 100.";
  const startsAt = dateValue(input, "startsAt", "La fecha de inicio", errors);
  const endsAt = dateValue(input, "endsAt", "La fecha de finalización", errors);
  if (!errors.startsAt && !errors.endsAt && startsAt >= endsAt)
    errors.endsAt = "La finalización debe ser posterior al inicio.";
  const registrationStartAt = optionalDate(
    input,
    "registrationStartAt",
    errors,
  );
  const registrationEndAt = optionalDate(input, "registrationEndAt", errors);
  if ((registrationStartAt === null) !== (registrationEndAt === null)) {
    errors.registrationStartAt =
      "Completa ambas fechas de preinscripción o deja ambas vacías.";
    errors.registrationEndAt =
      "Completa ambas fechas de preinscripción o deja ambas vacías.";
  } else if (
    registrationStartAt &&
    registrationEndAt &&
    registrationStartAt >= registrationEndAt
  ) {
    errors.registrationEndAt = "El cierre debe ser posterior a la apertura.";
  }
  if (Object.keys(errors).length > 0)
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "Revisa los campos indicados.",
      errors,
    );
  return {
    name,
    courseTypeId,
    description,
    level: levelRaw as CourseLevel,
    contentMarkdown: input.contentMarkdown?.trim() || null,
    instructorName: input.instructorName?.trim() || null,
    artwork: input.artwork?.trim() || null,
    schedule,
    conditions,
    startsAt,
    endsAt,
    registrationStartAt,
    registrationEndAt,
    minimumGrade,
  };
}
