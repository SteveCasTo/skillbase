import type {
  AdminInterestMutationInput,
  InterestIssues,
  RegisterInterestInput,
} from "./types";

export const INTEREST_SUCCESS_MESSAGE =
  "Gracias por tu interés. Esta solicitud no reserva una plaza ni confirma una inscripción.";
export const PREFERENCE_ISSUE =
  "Selecciona una preferencia disponible o continúa sin preferencia.";
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controls = /\p{Cc}/u;
export class InterestError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly issues: InterestIssues = {},
  ) {
    super(message);
  }
}
export function interestAvailable(
  course: { status: string; registrationEndAt: Date | null; startsAt: Date },
  now: Date,
): boolean {
  return (
    course.status === "PUBLISHED" &&
    now < (course.registrationEndAt ?? course.startsAt)
  );
}
export function validateRegisterInterest(
  raw: unknown,
): Required<RegisterInterestInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new InterestError(
      "INVALID_REQUEST",
      400,
      "La solicitud no es válida.",
    );
  const input = raw as Record<string, unknown>;
  const fields = [
    "firstName",
    "lastName",
    "email",
    "phone",
    "preferredGroupId",
  ] as const;
  if (
    Object.keys(input).some(
      (key) => !fields.includes(key as (typeof fields)[number]),
    )
  )
    throw new InterestError(
      "INVALID_REQUEST",
      400,
      "La solicitud no es válida.",
    );
  const issues: InterestIssues = {};
  const value = (
    field: (typeof fields)[number],
    max: number,
    required: boolean,
  ): string => {
    const original = input[field];
    if (
      typeof original !== "string" &&
      !(!required && (original === null || original === undefined))
    ) {
      issues[field] = "Introduce un valor válido.";
      return "";
    }
    const text = typeof original === "string" ? original.trim() : "";
    if (
      (required && !text) ||
      [...text].length > max ||
      controls.test(typeof original === "string" ? original : "")
    )
      issues[field] = "Introduce un valor válido.";
    return text;
  };
  const firstName = value("firstName", 100, true);
  const lastName = value("lastName", 150, true);
  const email = value("email", 254, true).toLowerCase();
  if ([...email].length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
    issues.email = "Introduce un email válido.";
  const phone = value("phone", 32, false) || null;
  const preferredGroupId = value("preferredGroupId", 36, false) || null;
  if (preferredGroupId && !UUID.test(preferredGroupId))
    issues.preferredGroupId = PREFERENCE_ISSUE;
  if (Object.keys(issues).length)
    throw new InterestError(
      "VALIDATION_FAILED",
      422,
      "Revisa los campos indicados.",
      issues,
    );
  return { firstName, lastName, email, phone, preferredGroupId };
}
export function validateInterestMutation(
  raw: unknown,
): AdminInterestMutationInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new InterestError(
      "INVALID_REQUEST",
      400,
      "La solicitud no es válida.",
    );
  const input = raw as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["intent", "interestRegistrationId", "revision"].includes(key),
    ) ||
    (input.intent !== "cancel" && input.intent !== "reactivate") ||
    typeof input.interestRegistrationId !== "string" ||
    !UUID.test(input.interestRegistrationId) ||
    typeof input.revision !== "string"
  )
    throw new InterestError(
      "INVALID_REQUEST",
      400,
      "La solicitud no es válida.",
    );
  const date = new Date(input.revision);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.revision) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== input.revision
  )
    throw new InterestError(
      "VALIDATION_FAILED",
      422,
      "La revisión no es válida.",
    );
  return {
    intent: input.intent,
    interestRegistrationId: input.interestRegistrationId,
    revision: input.revision,
  };
}
