import type {
  InterestFormValues,
  PublicInterestPostPayload,
} from "@/domain/interests/types";

export const INTEREST_SUCCESS_MESSAGE =
  "Gracias por tu interés. Esta solicitud no reserva una plaza ni confirma una inscripción.";

export const EMPTY_INTEREST_VALUES: InterestFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  preferredGroupId: "",
};

export function interestGroupLabel(group: {
  startTime: string;
  endTime: string;
}): string {
  return `Lunes a viernes, ${group.startTime}–${group.endTime}`;
}

/** Validate transport shape only; eligibility and input validation remain server-owned. */
export function isPublicInterestPayload(
  value: unknown,
): value is PublicInterestPostPayload {
  if (
    !value ||
    typeof value !== "object" ||
    !("ok" in value) ||
    !("message" in value) ||
    typeof value.message !== "string"
  )
    return false;
  if (value.ok === true) return value.message === INTEREST_SUCCESS_MESSAGE;
  if (
    value.ok !== false ||
    !("code" in value) ||
    typeof value.code !== "string" ||
    !("issues" in value) ||
    !value.issues ||
    typeof value.issues !== "object" ||
    Array.isArray(value.issues)
  )
    return false;
  return Object.entries(value.issues).every(
    ([key, message]) =>
      Object.hasOwn(EMPTY_INTEREST_VALUES, key) && typeof message === "string",
  );
}
