import { CourseDomainError } from "./errors";
import { boliviaCivilToInstant } from "./bolivia-time";
import { COURSE_LEVELS, type CourseData, type CourseLevel } from "./types";
import { weekdayMask } from "./weekday-schedule";

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

function optionalRegistrationDate(
  input: CourseInput,
  dateKey: string,
  legacyKey: string,
  isClosing: boolean,
  errors: Record<string, string>,
): Date | null {
  if (input[dateKey] === undefined)
    return optionalDate(input, legacyKey, errors);
  const raw = input[dateKey] ?? "";
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    errors[dateKey] = "La fecha debe usar el formato YYYY-MM-DD.";
    return null;
  }
  let civilDate = raw;
  try {
    // Reuse strict Bolivia civil validation rather than allowing Date rollover.
    boliviaCivilToInstant(`${raw}T00:00`);
    if (isClosing) {
      const year = Number(raw.slice(0, 4));
      const month = Number(raw.slice(5, 7));
      const day = Number(raw.slice(8, 10));
      civilDate = new Date(Date.UTC(year, month - 1, day + 1))
        .toISOString()
        .slice(0, 10);
    }
    return boliviaCivilToInstant(`${civilDate}T00:00`);
  } catch {
    errors[dateKey] = "La fecha debe ser una fecha civil válida de Bolivia.";
    return null;
  }
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
  let weekdaysMask: number | null = null;
  if (input.weekdays !== undefined) {
    try {
      weekdaysMask = weekdayMask(input.weekdays.split(",").map(Number));
    } catch {
      errors.weekdays = "Selecciona días de lunes a viernes sin repetir.";
    }
  }
  if (weekdaysMask !== null && weekdaysMask !== 31)
    errors.weekdays = "Las clases deben ser de lunes a viernes.";
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
  if (
    input.instructorId &&
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(input.instructorId)
  )
    errors.instructorId = "Selecciona un instructor registrado.";
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
  const registrationStartAt = optionalRegistrationDate(
    input,
    "registrationStartDate",
    "registrationStartAt",
    false,
    errors,
  );
  const registrationEndAt = optionalRegistrationDate(
    input,
    "registrationEndDate",
    "registrationEndAt",
    true,
    errors,
  );
  if ((registrationStartAt === null) !== (registrationEndAt === null)) {
    const startKey =
      input.registrationStartDate !== undefined
        ? "registrationStartDate"
        : "registrationStartAt";
    const endKey =
      input.registrationEndDate !== undefined
        ? "registrationEndDate"
        : "registrationEndAt";
    errors[startKey] =
      "Completa ambas fechas de preinscripción o deja ambas vacías.";
    errors[endKey] =
      "Completa ambas fechas de preinscripción o deja ambas vacías.";
  } else if (
    registrationStartAt &&
    registrationEndAt &&
    registrationStartAt >= registrationEndAt
  ) {
    errors.registrationEndAt = "El cierre debe ser posterior a la apertura.";
  }
  if (
    !errors.startsAt &&
    !errors.registrationEndAt &&
    registrationEndAt &&
    registrationEndAt > startsAt
  )
    errors.registrationEndAt =
      "El cierre debe ser anterior al inicio de clases.";
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
    instructorId: input.instructorId?.trim() || null,
    artwork: input.artwork?.trim() || null,
    schedule,
    weekdaysMask,
    conditions,
    startsAt,
    endsAt,
    registrationStartAt,
    registrationEndAt,
    minimumGrade,
  };
}
