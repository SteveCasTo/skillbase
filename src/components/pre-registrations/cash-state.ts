import { RegistrationError } from "@/domain/pre-registrations/errors";
import { assertRefund } from "@/domain/pre-registrations/finance";
import { assertAdditionalPayment } from "@/domain/pre-registrations/policies";
import { validateCashInput } from "@/domain/pre-registrations/validation";
import type {
  AdminRegistrationDto,
  LedgerKind,
} from "@/domain/pre-registrations/types";
import {
  moneyFieldIssues,
  parseMoneyInput,
  type FormValues,
} from "./presentation";

export function cashFormState(
  registration: AdminRegistrationDto,
  kind: LedgerKind,
  startsAt: string,
  serverNow: string,
  values: FormValues,
) {
  try {
    const cash = validateCashInput(
      {
        amountCents: parseMoneyInput(values.amount ?? ""),
        effectiveDate: values.effectiveDate || null,
        reason: values.reason,
      },
      new Date(serverNow),
      kind === "REFUND",
    );
    if (kind === "REFUND")
      assertRefund(registration.state, registration, cash.amountCents);
    else
      assertAdditionalPayment(
        registration.state,
        registration,
        cash.amountCents,
        new Date(startsAt),
        new Date(serverNow),
      );
    return { valid: true, issues: {} as Readonly<Record<string, string>> };
  } catch (error) {
    if (!(error instanceof RegistrationError)) throw error;
    return {
      valid: false,
      issues: Object.keys(error.issues).length
        ? moneyFieldIssues(error.issues)
        : { form: error.message },
    };
  }
}
