import {
  boliviaCivilToInstant,
  instantToBoliviaCivil,
} from "@/domain/courses/bolivia-time";
import { RegistrationError } from "./errors";

export function boliviaToday(now: Date): string {
  return instantToBoliviaCivil(now).slice(0, 10);
}
export function firstDayDeadlineExclusive(startsAt: Date): Date {
  const midnight = boliviaCivilToInstant(`${boliviaToday(startsAt)}T00:00`);
  return new Date(midnight.getTime() + 86_400_000);
}
export function validateCashEffectiveDate(
  value: string | null,
  now: Date,
): string {
  const date = value ?? boliviaToday(now);
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error("invalid");
    boliviaCivilToInstant(`${date}T00:00`);
    if (date > boliviaToday(now)) throw new Error("future");
  } catch {
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "La fecha efectiva debe ser una fecha válida, no futura, en Bolivia.",
      { effectiveDate: "Selecciona hoy o una fecha pasada válida." },
    );
  }
  return date;
}
