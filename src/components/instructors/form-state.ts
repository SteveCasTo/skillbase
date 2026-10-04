import {
  InstructorError,
  validateInstructor,
} from "@/domain/instructors/profile";
import { requirePassword } from "@/domain/auth/identity";
import { normalizeEmail } from "@/domain/auth/policies";

type Values = Readonly<Record<string, string | undefined>>;

/** Presentation state only; the server remains authoritative for every POST. */
export function instructorFormState(values: Values, baseline?: Values) {
  const errors: Record<string, string> = {};
  try {
    validateInstructor(values);
  } catch (error) {
    if (!(error instanceof InstructorError)) throw error;
    Object.assign(errors, error.fieldErrors);
  }
  if (!baseline) {
    try {
      requirePassword(values.password ?? "");
    } catch {
      errors.password = "Usa entre 12 y 128 caracteres.";
    }
  }
  const normalized = (input: Values) => ({
    firstName: input.firstName?.trim() ?? "",
    lastName: input.lastName?.trim() ?? "",
    email: normalizeEmail(input.email ?? ""),
    phone: input.phone?.trim() ?? "",
  });
  const current = normalized(values);
  const initial = baseline ? normalized(baseline) : null;
  // Email is read-only in edit mode and is not an editable change.
  const changed =
    !initial ||
    current.firstName !== initial.firstName ||
    current.lastName !== initial.lastName ||
    current.phone !== initial.phone;
  const valid = Object.keys(errors).length === 0;
  return { errors, valid, changed, canSubmit: valid && changed };
}
