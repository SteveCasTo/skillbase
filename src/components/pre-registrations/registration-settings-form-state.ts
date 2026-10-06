import { RegistrationError } from "@/domain/pre-registrations/errors";
import { validateSettings } from "@/domain/pre-registrations/money";

export interface RegistrationSettingsFormValues {
  minimumPaymentPercent: number;
  auxiliaryDiscountPercent: number;
}

export type RegistrationSettingsFormInput = Readonly<
  Record<keyof RegistrationSettingsFormValues, string | undefined>
>;

const settingsFields = [
  "minimumPaymentPercent",
  "auxiliaryDiscountPercent",
] as const;

export function registrationSettingsFormState(
  input: RegistrationSettingsFormInput,
  baseline?: RegistrationSettingsFormValues,
) {
  const errors: Partial<Record<keyof RegistrationSettingsFormValues, string>> =
    {};
  const values = {
    minimumPaymentPercent: Number.NaN,
    auxiliaryDiscountPercent: Number.NaN,
  };

  for (const name of settingsFields) {
    const raw = input[name] ?? "";
    values[name] = /^\d+$/u.test(raw) ? Number(raw) : Number.NaN;
  }

  try {
    validateSettings({ ...values, revision: 1 });
  } catch (error) {
    if (!(error instanceof RegistrationError)) throw error;
    for (const name of settingsFields) {
      const message = error.issues[name];
      if (message) errors[name] = message;
    }
  }

  const valid = Object.keys(errors).length === 0;
  const complete: RegistrationSettingsFormValues | null = valid ? values : null;
  const changed =
    baseline === undefined ||
    (complete !== null &&
      (complete.minimumPaymentPercent !== baseline.minimumPaymentPercent ||
        complete.auxiliaryDiscountPercent !==
          baseline.auxiliaryDiscountPercent));

  return {
    errors,
    valid,
    changed,
    canSubmit: valid && changed,
    values: complete,
  };
}

/** Prevent repeated native submissions while the first POST is navigating. */
export function createPendingSubmitGuard(): {
  begin(): boolean;
  reset(): void;
} {
  let pending = false;
  return {
    begin() {
      if (pending) return false;
      pending = true;
      return true;
    },
    reset() {
      pending = false;
    },
  };
}
