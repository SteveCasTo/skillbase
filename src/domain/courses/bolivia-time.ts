import { CourseDomainError } from "./errors";

export const COURSE_CIVIL_TIME_ZONE = "America/La_Paz";
const BOLIVIA_UTC_OFFSET_HOURS = 4;
const CIVIL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Course form dates are Bolivia civil time. Bolivia is permanently UTC-04
 * without daylight-saving transitions, so conversion is deterministic and
 * independent from the browser or server process timezone.
 */
export function boliviaCivilToInstant(value: string): Date {
  const match = CIVIL_DATE_TIME_PATTERN.exec(value);
  if (!match)
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "La fecha debe usar el formato YYYY-MM-DDTHH:mm.",
    );
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const civilTimestamp = Date.UTC(year, month - 1, day, hour, minute);
  const civil = new Date(civilTimestamp);
  const isRealDate =
    civil.getUTCFullYear() === year &&
    civil.getUTCMonth() === month - 1 &&
    civil.getUTCDate() === day &&
    civil.getUTCHours() === hour &&
    civil.getUTCMinutes() === minute;
  if (!isRealDate)
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "La fecha civil de Bolivia no es válida.",
    );
  return new Date(civilTimestamp + BOLIVIA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

export function instantToBoliviaCivil(value: Date): string {
  if (Number.isNaN(value.getTime()))
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "El instante no es válido.",
    );
  return new Date(value.getTime() - BOLIVIA_UTC_OFFSET_HOURS * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}
