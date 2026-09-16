import { CourseDomainError } from "./errors";
import type { CourseStatus, RegistrationAvailability } from "./types";

export function normalizeSlug(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug)
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "No se pudo generar un slug válido.",
      { name: "El nombre debe incluir letras o números." },
    );
  return slug;
}

export function assertTransition(
  current: CourseStatus,
  next: CourseStatus,
): void {
  const valid =
    (current === "DRAFT" && (next === "PUBLISHED" || next === "ARCHIVED")) ||
    (current === "PUBLISHED" && (next === "DRAFT" || next === "ARCHIVED"));
  if (!valid)
    throw new CourseDomainError(
      "INVALID_TRANSITION",
      `No se puede cambiar un curso de ${current} a ${next}.`,
    );
}

export function registrationAvailability(
  start: Date | null,
  end: Date | null,
  now = new Date(),
): RegistrationAvailability {
  if (!start || !end) return "UNAVAILABLE";
  if (now < start) return "UPCOMING";
  if (now >= end) return "CLOSED";
  return "OPEN";
}
