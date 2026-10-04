import { RegistrationError } from "./errors";
import { assertCents } from "./money";
import { validateParticipant } from "./participant";
import { validateCashEffectiveDate } from "./time";
import {
  REGISTRATION_PARTICIPANT_TYPES,
  type CashInput,
  type CreateRegistrationInput,
  type RegistrationParticipantType,
} from "./types";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function validateRegistrationId(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuid.test(value))
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Revisa los datos de la solicitud.",
      { [field]: "El identificador no es válido." },
    );
  return value.toLowerCase();
}
export function validateRegistrationRevision(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(new Date(value).getTime()) ||
    new Date(value).toISOString() !== value
  )
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "La revisión no es válida.",
      { revision: "Recarga el registro para obtener su revisión vigente." },
    );
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "La solicitud no es válida.",
    );
  return value as Record<string, unknown>;
}
export function validateCashInput(
  raw: unknown,
  now: Date,
  requireReason = true,
): CashInput {
  const input = object(raw);
  if (typeof input.amountCents !== "number")
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Introduce el monto en centavos.",
      { amountCents: "Introduce un monto entero positivo." },
    );
  assertCents(input.amountCents, "amountCents", true);
  if (
    input.effectiveDate !== null &&
    input.effectiveDate !== undefined &&
    typeof input.effectiveDate !== "string"
  )
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "La fecha efectiva no es válida.",
      { effectiveDate: "Selecciona una fecha válida." },
    );
  const effectiveDate =
    typeof input.effectiveDate === "string" ? input.effectiveDate : null;
  validateCashEffectiveDate(effectiveDate, now);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (
    (requireReason && !reason) ||
    [...reason].length > 500 ||
    /\p{Cc}/u.test(typeof input.reason === "string" ? input.reason : "")
  )
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Introduce un motivo válido.",
      { reason: "Introduce un motivo de hasta 500 caracteres." },
    );
  return {
    amountCents: input.amountCents,
    effectiveDate,
    reason: reason || null,
  };
}
/** Pure boundary validation; authoritative price/state/capacity remain transactional. */
export function validateCreateRegistration(
  raw: unknown,
  now: Date,
): CreateRegistrationInput {
  const input = object(raw);
  const participant = validateParticipant(input.participant);
  if (
    typeof input.participantType !== "string" ||
    !REGISTRATION_PARTICIPANT_TYPES.includes(
      input.participantType as RegistrationParticipantType,
    )
  )
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Selecciona un tipo válido.",
      { participantType: "Selecciona un tipo de participante." },
    );
  if (typeof input.firstDayException !== "boolean")
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Indica si solicitas la excepción del primer día.",
    );
  if (
    typeof input.settingsRevision !== "number" ||
    !Number.isInteger(input.settingsRevision) ||
    input.settingsRevision < 1 ||
    input.settingsRevision > 2_147_483_647
  )
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "La revisión de configuración no es válida.",
    );
  return {
    requestKey: validateRegistrationId(input.requestKey, "requestKey"),
    courseId: validateRegistrationId(input.courseId, "courseId"),
    groupId: validateRegistrationId(input.groupId, "groupId"),
    participant,
    participantType: input.participantType as RegistrationParticipantType,
    sourceInterestId:
      input.sourceInterestId == null
        ? null
        : validateRegistrationId(input.sourceInterestId, "sourceInterestId"),
    settingsRevision: input.settingsRevision,
    courseRevision: validateRegistrationRevision(input.courseRevision),
    firstDayException: input.firstDayException,
    initialPayment:
      input.initialPayment == null
        ? null
        : validateCashInput(input.initialPayment, now, false),
  };
}
