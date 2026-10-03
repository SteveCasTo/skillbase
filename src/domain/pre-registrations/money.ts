import { money } from "@/domain/courses/validation";
import { RegistrationError } from "./errors";
import type {
  PriceSnapshot,
  RegistrationParticipantType,
  RegistrationSettings,
} from "./types";

export const MAX_REGISTRATION_CENTS = 999_999_999_999;
export const DEFAULT_REGISTRATION_SETTINGS: RegistrationSettings =
  Object.freeze({
    minimumPaymentPercent: 25,
    auxiliaryDiscountPercent: 50,
    revision: 1,
  });
export function assertCents(
  value: number,
  field = "amountCents",
  positive = false,
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0) ||
    value > MAX_REGISTRATION_CENTS
  )
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Introduce un monto válido en centavos.",
      {
        [field]: positive
          ? "El monto debe ser positivo y estar dentro del límite permitido."
          : "El monto debe ser no negativo y estar dentro del límite permitido.",
      },
    );
}
export function decimalToCents(value: string, field = "amountCents"): number {
  const issues: Record<string, string> = {};
  const normalized = money({ [field]: value }, field, issues);
  if (Object.keys(issues).length)
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Revisa el monto.",
      issues,
    );
  const cents = Number(BigInt(normalized.replace(".", "")));
  assertCents(cents, field);
  return cents;
}
export function centsToDecimal(value: number): string {
  assertCents(value);
  const cents = BigInt(value);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
export function validateSettings(
  value: RegistrationSettings,
): RegistrationSettings {
  const issues: Record<string, string> = {};
  for (const [field, minimum] of [
    ["minimumPaymentPercent", 1],
    ["auxiliaryDiscountPercent", 0],
  ] as const) {
    if (
      !Number.isInteger(value[field]) ||
      value[field] < minimum ||
      value[field] > 100
    )
      issues[field] = `Introduce un porcentaje entero de ${minimum} a 100.`;
  }
  if (
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    value.revision > 2_147_483_647
  )
    issues.revision = "La revisión no es válida.";
  if (Object.keys(issues).length)
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Revisa la configuración.",
      issues,
    );
  return { ...value };
}
export function createPriceSnapshot(input: {
  participantType: RegistrationParticipantType;
  courseTypeRevisionId: string;
  studentAmount: string;
  externalAmount: string;
  settings: RegistrationSettings;
}): PriceSnapshot {
  const settings = validateSettings(input.settings);
  if (!["STUDENT", "EXTERNAL", "AUXILIARY"].includes(input.participantType))
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Selecciona un tipo de participante válido.",
      { participantType: "Selecciona un tipo válido." },
    );
  const basePriceCents = decimalToCents(
    input.participantType === "EXTERNAL"
      ? input.externalAmount
      : input.studentAmount,
  );
  const discountPercent =
    input.participantType === "AUXILIARY"
      ? settings.auxiliaryDiscountPercent
      : 0;
  // HALF_UP of the final discounted price; BigInt prevents intermediate overflow.
  const totalPriceCents = Number(
    (BigInt(basePriceCents) * BigInt(100 - discountPercent) + 50n) / 100n,
  );
  const minimumPaymentCents = Number(
    (BigInt(totalPriceCents) * BigInt(settings.minimumPaymentPercent) + 99n) /
      100n,
  );
  return Object.freeze({
    currency: "BOB",
    courseTypeRevisionId: input.courseTypeRevisionId,
    settingsRevision: settings.revision,
    participantType: input.participantType,
    basePriceCents,
    discountPercent,
    totalPriceCents,
    minimumPaymentPercent: settings.minimumPaymentPercent,
    minimumPaymentCents,
  });
}
