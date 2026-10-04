import { RegistrationError } from "@/domain/pre-registrations/errors";
import {
  centsToDecimal,
  createPriceSnapshot,
  decimalToCents,
} from "@/domain/pre-registrations/money";
import { validateParticipant } from "@/domain/pre-registrations/participant";
import {
  assertEligibleDestination,
  assertRegistrationPayment,
  normalRegistrationOpen,
} from "@/domain/pre-registrations/policies";
import { boliviaToday } from "@/domain/pre-registrations/time";
import { validateCashInput } from "@/domain/pre-registrations/validation";
import type {
  CreateRegistrationInput,
  FinancialStatus,
  MembershipStatus,
  ParticipantData,
  RegistrationCourseContext,
  RegistrationFormDto,
} from "@/domain/pre-registrations/types";

/** Raw HTML values only: `amount` is decimal BOB, never integer cents. */
export type FormValues = Readonly<Record<string, string>>;
/** Domain errors keep their cent-based contract; inline errors target HTML names. */
export function moneyFieldIssues(
  issues: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(issues).map(([field, message]) => [
      field === "amountCents" ? "amount" : field,
      message,
    ]),
  );
}
export const membershipLabels: Record<MembershipStatus, string> = {
  PREINSCRITO: "Preinscrito",
  INSCRITO: "Inscrito",
  SALDOVENCIDO: "Saldo vencido",
  CANCELADO: "Cancelado",
};
export const financeLabels: Record<FinancialStatus, string> = {
  EXEMPT: "Gratuito",
  UNPAID: "Sin pago",
  PARTIAL: "Pago parcial",
  PAID: "Pagado",
  REFUND_DUE: "Devolución pendiente",
  REFUNDED: "Devuelto",
};
export function formatMoney(cents: number): string {
  const [whole, fraction] = centsToDecimal(cents).split(".");
  return `Bs ${whole!.replace(/\B(?=(\d{3})+(?!\d))/gu, ".")},${fraction}`;
}
/** Accept a decimal comma for Bolivian keyboards, never grouping separators. */
export function parseMoneyInput(value: string): number {
  return decimalToCents(value.replace(",", "."));
}
export function formatDate(instant: string): string {
  return new Intl.DateTimeFormat("es-BO", {
    timeZone: "America/La_Paz",
    dateStyle: "medium",
  }).format(new Date(instant));
}
export function courseContext(
  dto: RegistrationFormDto,
): RegistrationCourseContext {
  return {
    ...dto.course,
    startsAt: new Date(dto.course.startsAt),
    registrationEndAt: dto.course.registrationEndAt
      ? new Date(dto.course.registrationEndAt)
      : null,
  };
}
export function registrationWindow(
  dto: RegistrationFormDto,
  serverNow: string,
) {
  const course = courseContext(dto);
  const now = new Date(serverNow);
  const ordinary = normalRegistrationOpen(course, now);
  return {
    ordinary,
    firstDay: !ordinary && boliviaToday(now) === boliviaToday(course.startsAt),
  };
}
export function pricePreview(
  dto: RegistrationFormDto,
  participantType: CreateRegistrationInput["participantType"],
) {
  return createPriceSnapshot({
    ...dto.course,
    participantType,
    settings: dto.settings,
  });
}
export function participantValues(values: FormValues): ParticipantData {
  return validateParticipant({
    ci: values.ci ?? "",
    firstName: values.firstName ?? "",
    lastName: values.lastName ?? "",
    email: values.email ?? "",
    phone: values.phone || null,
  });
}
export function normalizedParticipantDirty(
  values: FormValues,
  baseline: ParticipantData,
): boolean {
  try {
    return (
      JSON.stringify(participantValues(values)) !==
      JSON.stringify(validateParticipant(baseline))
    );
  } catch {
    return true;
  }
}
export function registrationFormState(
  dto: RegistrationFormDto,
  values: FormValues,
  serverNow: string,
) {
  const issues: Record<string, string> = {};
  const collect = (operation: () => void) => {
    try {
      operation();
    } catch (error) {
      if (!(error instanceof RegistrationError)) throw error;
      Object.assign(
        issues,
        Object.keys(error.issues).length
          ? moneyFieldIssues(error.issues)
          : { form: error.message },
      );
    }
  };
  collect(() => {
    participantValues(values);
  });
  collect(() => {
    const group = dto.groups.find((item) => item.id === values.groupId);
    if (!group)
      throw new RegistrationError("VALIDATION_FAILED", "Selecciona un grupo.", {
        groupId: "Selecciona un grupo con cupo.",
      });
    assertEligibleDestination(courseContext(dto), {
      ...group,
      courseId: dto.course.id,
      courseTypeRevisionId: dto.course.courseTypeRevisionId,
    });
  });
  collect(() => {
    const price = pricePreview(
      dto,
      values.participantType as CreateRegistrationInput["participantType"],
    );
    const free = price.totalPriceCents === 0;
    const amount = free
      ? null
      : values.amount
        ? parseMoneyInput(values.amount)
        : null;
    const now = new Date(serverNow);
    assertRegistrationPayment(
      courseContext(dto),
      price,
      amount,
      values.firstDayException === "true",
      now,
    );
    if (!free && amount !== null)
      validateCashInput(
        {
          amountCents: amount,
          effectiveDate: values.effectiveDate || null,
          reason: values.reason,
        },
        now,
        false,
      );
  });
  return { issues, valid: Object.keys(issues).length === 0 };
}
