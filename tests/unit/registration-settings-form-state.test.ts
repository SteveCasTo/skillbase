import { expect, test } from "bun:test";
import {
  createPendingSubmitGuard,
  registrationSettingsFormState,
} from "@/components/pre-registrations/registration-settings-form-state";

const baseline = {
  minimumPaymentPercent: 25,
  auxiliaryDiscountPercent: 50,
};
const values = {
  minimumPaymentPercent: "25",
  auxiliaryDiscountPercent: "50",
};

test("accepts inclusive minimum and maximum percentages, including 100% discount", () => {
  expect(
    registrationSettingsFormState(
      { minimumPaymentPercent: "1", auxiliaryDiscountPercent: "0" },
      baseline,
    ),
  ).toMatchObject({ valid: true, canSubmit: true });
  expect(
    registrationSettingsFormState(
      { minimumPaymentPercent: "100", auxiliaryDiscountPercent: "100" },
      baseline,
    ),
  ).toMatchObject({ valid: true, canSubmit: true });
});

test("rejects empty, fractional, and out-of-range field values with field-specific errors", () => {
  for (const [name, value] of [
    ["minimumPaymentPercent", ""],
    ["minimumPaymentPercent", "0"],
    ["minimumPaymentPercent", "101"],
    ["minimumPaymentPercent", "25.5"],
    ["auxiliaryDiscountPercent", ""],
    ["auxiliaryDiscountPercent", "-1"],
    ["auxiliaryDiscountPercent", "101"],
    ["auxiliaryDiscountPercent", "50.5"],
  ] as const) {
    const result = registrationSettingsFormState(
      { ...values, [name]: value },
      baseline,
    );
    expect(result.valid).toBe(false);
    expect(result.canSubmit).toBe(false);
    expect(result.errors[name]).toBeTruthy();
  }
});

test("compares numeric values to baseline, so padded numbers are unchanged", () => {
  expect(
    registrationSettingsFormState(
      { minimumPaymentPercent: "025", auxiliaryDiscountPercent: "050" },
      baseline,
    ),
  ).toMatchObject({ valid: true, changed: false, canSubmit: false });
});

test("enables save for a valid change and disables it again when restored", () => {
  expect(
    registrationSettingsFormState(
      { ...values, auxiliaryDiscountPercent: "100" },
      baseline,
    ),
  ).toMatchObject({ valid: true, changed: true, canSubmit: true });
  expect(registrationSettingsFormState(values, baseline)).toMatchObject({
    valid: true,
    changed: false,
    canSubmit: false,
  });
});

test("valid initial values remain submittable without JavaScript baseline enhancement", () => {
  expect(registrationSettingsFormState(values)).toMatchObject({
    valid: true,
    changed: true,
    canSubmit: true,
  });
});

test("blocks duplicate submissions while pending and re-enables retry after failure", () => {
  const submission = createPendingSubmitGuard();
  expect(submission.begin()).toBe(true);
  expect(submission.begin()).toBe(false);
  submission.reset();
  expect(submission.begin()).toBe(true);
});
