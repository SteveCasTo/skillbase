export interface RegistrationSettingsFormValues {
  minimumPaymentPercent: number;
  auxiliaryDiscountPercent: number;
}

export type RegistrationSettingsFormInput = Readonly<
  Record<keyof RegistrationSettingsFormValues, string | undefined>
>;

const fieldRules = {
  minimumPaymentPercent: { min: 1, max: 100 },
  auxiliaryDiscountPercent: { min: 0, max: 100 },
} as const;

export function registrationSettingsFormState(
  input: RegistrationSettingsFormInput,
  baseline?: RegistrationSettingsFormValues,
) {
  const errors: Partial<Record<keyof RegistrationSettingsFormValues, string>> =
    {};
  const values: Partial<RegistrationSettingsFormValues> = {};

  for (const name of Object.keys(
    fieldRules,
  ) as (keyof RegistrationSettingsFormValues)[]) {
    const raw = input[name]?.trim() ?? "";
    const value = raw === "" ? Number.NaN : Number(raw);
    const { min, max } = fieldRules[name];
    if (!Number.isInteger(value)) {
      errors[name] = "Ingresa un porcentaje entero.";
    } else if (value < min || value > max) {
      errors[name] = `Ingresa un valor entre ${min} y ${max}.`;
    } else {
      values[name] = value;
    }
  }

  const valid = Object.keys(errors).length === 0;
  const complete = valid ? (values as RegistrationSettingsFormValues) : null;
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
export function createPendingSubmitGuard(): () => boolean {
  let pending = false;
  return () => {
    if (pending) return false;
    pending = true;
    return true;
  };
}
