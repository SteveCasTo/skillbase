import { normalizeEmail } from "@/domain/auth/policies";

export interface InstructorProfileData {
  firstName: string;
  lastName: string;
  phone: string | null;
}
export interface InstructorProfile extends InstructorProfileData {
  id: string;
  email: string;
  status: "INVITED" | "ACTIVE" | "DISABLED";
  updatedAt: Date;
}
export class InstructorError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "InstructorError";
  }
}

export function validateInstructor(
  input: Readonly<Record<string, string | undefined>>,
) {
  const errors: Record<string, string> = {};
  const firstName = input.firstName?.trim() ?? "";
  const lastName = input.lastName?.trim() ?? "";
  const email = normalizeEmail(input.email ?? "");
  const phone = input.phone?.trim() || null;
  // eslint-disable-next-line no-control-regex
  const controls = /[\u0000-\u001f\u007f]/u;
  for (const [key, value, max] of [
    ["firstName", firstName, 100],
    ["lastName", lastName, 150],
  ] as const)
    if (!value || value.length > max || controls.test(value))
      errors[key] = `Indica un nombre válido de hasta ${max} caracteres.`;
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
    controls.test(email)
  )
    errors.email = "Indica un correo válido.";
  if (phone && (phone.length > 32 || controls.test(phone)))
    errors.phone = "Indica un teléfono de hasta 32 caracteres.";
  if (Object.keys(errors).length)
    throw new InstructorError("Revisa los datos del instructor.", errors);
  return { firstName, lastName, email, phone };
}

export function instructorFullName(profile: InstructorProfileData): string {
  return `${profile.firstName} ${profile.lastName}`;
}
