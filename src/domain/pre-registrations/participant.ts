import { RegistrationError } from "./errors";
import type { ParticipantData } from "./types";

/** CI is a string identity, not a number or a nationally validated document. */
export function normalizeParticipantCi(value: string): string {
  return value.trim().replace(/\s+/gu, "").toUpperCase();
}
export function validateParticipant(raw: unknown): ParticipantData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Introduce los datos de la persona.",
    );
  const input = raw as Record<string, unknown>;
  const issues: Record<string, string> = {};
  const text = (field: string, max: number, optional = false): string => {
    const rawValue = input[field];
    if (optional && (rawValue === null || rawValue === undefined)) return "";
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (
      (!optional && !value) ||
      typeof rawValue !== "string" ||
      [...value].length > max ||
      /\p{Cc}/u.test(typeof rawValue === "string" ? rawValue : "")
    )
      issues[field] = "Introduce un valor válido.";
    return value;
  };
  const ci = normalizeParticipantCi(text("ci", 80));
  if (!ci || [...ci].length > 64)
    issues.ci = "Introduce un CI de hasta 64 caracteres.";
  const firstName = text("firstName", 100);
  const lastName = text("lastName", 150);
  const email = text("email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
    issues.email = "Introduce un email válido.";
  const phone = text("phone", 32, true) || null;
  if (Object.keys(issues).length)
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Revisa los campos indicados.",
      issues,
    );
  return { ci, firstName, lastName, email, phone };
}
