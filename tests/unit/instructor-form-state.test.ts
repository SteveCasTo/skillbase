import { expect, test } from "bun:test";
import { instructorFormState } from "@/components/instructors/form-state";

const profile = {
  firstName: "Ana",
  lastName: "Pérez",
  email: "ana@example.test",
  phone: "",
};
const create = { ...profile, password: "a".repeat(12) };

test("creation starts disabled and requires every mandatory valid field", () => {
  expect(instructorFormState({}).canSubmit).toBe(false);
  expect(instructorFormState(create).canSubmit).toBe(true);
  for (const field of ["firstName", "lastName", "email", "password"]) {
    expect(instructorFormState({ ...create, [field]: "" }).canSubmit).toBe(
      false,
    );
    expect(
      instructorFormState({ ...create, [field]: "" }).errors[field],
    ).toBeTruthy();
  }
});

test("whitespace-only names and malformed email cannot enable creation", () => {
  for (const value of [
    { firstName: "   " },
    { lastName: "   " },
    { email: "not-an-email" },
    { email: "ana@example" },
    { email: "ana @example.test" },
  ])
    expect(instructorFormState({ ...create, ...value }).canSubmit).toBe(false);
});

test("password policy preserves exact characters and inclusive 12–128 boundaries", () => {
  for (const length of [0, 11, 129]) {
    expect(
      instructorFormState({ ...create, password: "a".repeat(length) })
        .canSubmit,
    ).toBe(false);
  }
  for (const length of [12, 128]) {
    expect(
      instructorFormState({ ...create, password: "a".repeat(length) })
        .canSubmit,
    ).toBe(true);
  }
  // Do not invent a stronger policy than the existing server requires.
  expect(
    instructorFormState({ ...create, password: " ".repeat(12) }).canSubmit,
  ).toBe(true);
});

test("optional phone may be empty or whitespace but must respect limits", () => {
  for (const phone of ["", "  ", "+591 70000000", "1".repeat(32)]) {
    expect(instructorFormState({ ...create, phone }).canSubmit).toBe(true);
  }
  expect(
    instructorFormState({ ...create, phone: "1".repeat(33) }).errors.phone,
  ).toBeTruthy();
  expect(
    instructorFormState({ ...create, phone: "12\n34" }).errors.phone,
  ).toBeTruthy();
});

test("client uses the same normalized name limits and control restrictions as server", () => {
  expect(
    instructorFormState({
      ...create,
      firstName: "a".repeat(100),
      lastName: "b".repeat(150),
    }).valid,
  ).toBe(true);
  for (const value of [
    { firstName: "a".repeat(101) },
    { lastName: "b".repeat(151) },
    { firstName: "A\u007fB" },
    { lastName: "A\tB" },
    { email: `${"a".repeat(242)}@example.test` },
  ])
    expect(instructorFormState({ ...create, ...value }).valid).toBe(false);
});

test("editing starts disabled without requiring an initial password", () => {
  expect(instructorFormState(profile, profile)).toMatchObject({
    valid: true,
    changed: false,
    canSubmit: false,
  });
  expect(
    instructorFormState({ ...profile, firstName: "María" }, profile).canSubmit,
  ).toBe(true);
});

test("normalized baseline ignores outer whitespace and email casing", () => {
  expect(
    instructorFormState(
      {
        firstName: " Ana ",
        lastName: " Pérez ",
        email: " ANA@EXAMPLE.TEST ",
        phone: "  ",
      },
      profile,
    ),
  ).toMatchObject({ valid: true, changed: false, canSubmit: false });
});

test("returning each editable field to its persisted value disables save again", () => {
  const baseline = { ...profile, phone: "+591 70000000" };
  for (const field of ["firstName", "lastName", "phone"]) {
    const edited = { ...baseline, [field]: "Changed" };
    expect(instructorFormState(edited, baseline).canSubmit).toBe(true);
    expect(
      instructorFormState(
        { ...edited, [field]: ` ${baseline[field as keyof typeof baseline]} ` },
        baseline,
      ).canSubmit,
    ).toBe(false);
  }
});

test("invalid real changes stay disabled and corrected values permit retry", () => {
  const invalid = { ...profile, firstName: "", phone: "123" };
  expect(instructorFormState(invalid, profile)).toMatchObject({
    valid: false,
    changed: true,
    canSubmit: false,
  });
  expect(
    instructorFormState({ ...invalid, firstName: "Ana" }, profile).canSubmit,
  ).toBe(true);
});

test("SSR validation errors keep attempted values compared against persisted baseline", () => {
  const attempted = { ...profile, firstName: "María" };
  expect(instructorFormState(attempted, profile).canSubmit).toBe(true);
  expect(instructorFormState(attempted, attempted).canSubmit).toBe(false);
});
