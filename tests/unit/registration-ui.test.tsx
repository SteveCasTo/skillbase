import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RegistrationSelect from "@/components/pre-registrations/RegistrationSelect";
import MoneyInput from "@/components/pre-registrations/MoneyInput";
import {
  formatMoney,
  normalizedParticipantDirty,
  parseMoneyInput,
  pricePreview,
  registrationFormState,
  registrationWindow,
} from "@/components/pre-registrations/presentation";
import { cashFormState } from "@/components/pre-registrations/cash-state";
import {
  createLatestSearch,
  createRequestState,
} from "@/components/pre-registrations/request-state";
import type {
  AdminRegistrationDto,
  RegistrationFormDto,
} from "@/domain/pre-registrations/types";
import { acceptsMoneyEdit } from "@/components/pre-registrations/money-input";

const dto: RegistrationFormDto = {
  course: {
    id: "course",
    name: "Curso",
    revision: "2026-10-01T00:00:00.000Z",
    status: "PUBLISHED",
    startsAt: "2026-10-10T12:00:00.000Z",
    registrationEndAt: null,
    courseTypeRevisionId: "tariff",
    studentAmount: "100.03",
    externalAmount: "150",
    instructorActive: true,
  },
  groups: [
    {
      id: "group",
      startsAt: "2026-10-10T12:00:00.000Z",
      endsAt: "2026-10-20T12:00:00.000Z",
      capacity: 5,
      occupied: 4,
      status: "PLANNED",
    },
  ],
  settings: {
    revision: 1,
    minimumPaymentPercent: 25,
    auxiliaryDiscountPercent: 50,
  },
  sourceInterest: null,
};
const now = "2026-10-03T12:00:00.000Z";
const values = {
  ci: "001-A",
  firstName: "Persona",
  lastName: "Prueba",
  email: "person@example.test",
  phone: "",
  groupId: "group",
  participantType: "STUDENT",
  amount: "25.01",
  effectiveDate: "2026-10-03",
  reason: "Primer pago",
};
const registration: AdminRegistrationDto = {
  id: "registration",
  courseId: "course",
  groupId: "group",
  participant: {
    id: "person",
    revision: now,
    ci: "001-A",
    firstName: "Persona",
    lastName: "Prueba",
    email: "person@example.test",
    phone: null,
  },
  state: "ACTIVE",
  membershipStatus: "PREINSCRITO",
  price: pricePreview(dto, "STUDENT"),
  sourceInterestId: null,
  firstDayException: false,
  cancellationReason: null,
  cancelledAt: null,
  revision: now,
  createdAt: now,
  paymentDeadlineExclusive: "2026-10-11T04:00:00.000Z",
  paidCents: 2501,
  refundedCents: 0,
  balanceCents: 7502,
  refundDueCents: 0,
  financialStatus: "PARTIAL",
};
describe("registration component presentation", () => {
  test("SSR currency field submits decimal BOB under amount, never amountCents", () => {
    const html = renderToStaticMarkup(
      createElement(MoneyInput, {
        id: "payment-amount",
        defaultValue: "25.50",
        required: true,
      }),
    );
    expect(html).toContain('name="amount"');
    expect(html).toContain('value="25.50"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).not.toContain('name="amountCents"');
    expect(parseMoneyInput("25.50")).toBe(2550);
    expect(parseMoneyInput("0.01")).toBe(1);
    expect(() => parseMoneyInput("0.001")).toThrow();
  });
  test("disabled free currency field is omitted from the native POST, not a zero cash row", () => {
    const html = renderToStaticMarkup(
      createElement(MoneyInput, {
        id: "free-amount",
        defaultValue: "25.50",
        disabled: true,
      }),
    );
    expect(html).toContain('name="amount"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('value="0"');
    const free = {
      ...dto,
      settings: { ...dto.settings, auxiliaryDiscountPercent: 100 },
    };
    const { amount, ...withoutCash } = values;
    expect(amount).toBe("25.01");
    expect(
      registrationFormState(
        free,
        { ...withoutCash, participantType: "AUXILIARY" },
        now,
      ).valid,
    ).toBe(true);
  });
  test("money typing admits partial decimals but not letters, signs or excess precision", () => {
    for (const value of ["", "1", "25.", "25,", "25,01"])
      expect(acceptsMoneyEdit(value)).toBe(true);
    for (const value of ["x", "1e2", "-1", "1.234", "1,2.3", "12345678901"])
      expect(acceptsMoneyEdit(value)).toBe(false);
  });
  test("uses exact cents and accepts decimal comma without ambiguous grouping", () => {
    expect(formatMoney(10003)).toBe("Bs 100,03");
    expect(parseMoneyInput("25,01")).toBe(2501);
    for (const invalid of ["1.000,00", "25,001", "-1", "1e2", "NaN"])
      expect(() => parseMoneyInput(invalid)).toThrow();
  });
  test("decimal BOB previews compare integer-cent minimums and expose raw-field errors", () => {
    expect(
      registrationFormState(dto, { ...values, amount: "25.50" }, now).valid,
    ).toBe(true);
    const belowMinimum = registrationFormState(
      dto,
      { ...values, amount: "25.00" },
      now,
    );
    expect(belowMinimum.valid).toBe(false);
    expect(belowMinimum.issues.amount).toBeDefined();
    expect(belowMinimum.issues.amountCents).toBeUndefined();
    expect(
      cashFormState(registration, "PAYMENT", dto.course.startsAt, now, {
        ...values,
        amount: "0.01",
      }).valid,
    ).toBe(true);
    const overBalance = cashFormState(
      registration,
      "PAYMENT",
      dto.course.startsAt,
      now,
      { ...values, amount: "75.03" },
    );
    expect(overBalance.issues.amount).toBeDefined();
    expect(overBalance.issues.amountCents).toBeUndefined();
  });
  test("required fields, valid deposit, zero and above total are gated by domain", () => {
    expect(registrationFormState(dto, values, now).valid).toBe(true);
    for (const overrides of [
      { ci: "" },
      { email: "invalid" },
      { firstName: "" },
      { groupId: "" },
      { amount: "25" },
      { amount: "0" },
      { amount: "100.04" },
      { effectiveDate: "2026-10-04" },
    ])
      expect(
        registrationFormState(dto, { ...values, ...overrides }, now).valid,
      ).toBe(false);
    expect(
      registrationFormState(dto, { ...values, amount: "25,01" }, now).valid,
    ).toBe(true);
  });
  test("free auxiliary has no required cash and no synthetic payment", () => {
    const free = {
      ...dto,
      settings: { ...dto.settings, auxiliaryDiscountPercent: 100 },
    };
    expect(pricePreview(free, "AUXILIARY").totalPriceCents).toBe(0);
    expect(
      registrationFormState(
        free,
        {
          ...values,
          participantType: "AUXILIARY",
          amount: "",
          effectiveDate: "",
          reason: "",
        },
        now,
      ).valid,
    ).toBe(true);
    expect(
      registrationFormState(
        free,
        { ...values, participantType: "STUDENT", amount: "" },
        now,
      ).valid,
    ).toBe(false);
  });
  test("first-day exception needs explicit opt-in and full payment using server clock", () => {
    const firstDay = "2026-10-10T13:00:00.000Z";
    expect(registrationWindow(dto, firstDay)).toEqual({
      ordinary: false,
      firstDay: true,
    });
    expect(registrationFormState(dto, values, firstDay).valid).toBe(false);
    expect(
      registrationFormState(
        dto,
        { ...values, firstDayException: "true" },
        firstDay,
      ).valid,
    ).toBe(false);
    expect(
      registrationFormState(
        dto,
        { ...values, firstDayException: "true", amount: "100.03" },
        firstDay,
      ).valid,
    ).toBe(true);
    expect(
      registrationFormState(
        dto,
        { ...values, firstDayException: "true", amount: "100.03" },
        "2026-10-11T04:00:00.000Z",
      ).valid,
    ).toBe(false);
  });
  test("full, cancelled and inactive destinations cannot submit", () => {
    expect(
      registrationFormState(
        { ...dto, groups: [{ ...dto.groups[0]!, occupied: 5 }] },
        values,
        now,
      ).valid,
    ).toBe(false);
    expect(
      registrationFormState(
        { ...dto, groups: [{ ...dto.groups[0]!, status: "CANCELLED" }] },
        values,
        now,
      ).valid,
    ).toBe(false);
    expect(
      registrationFormState(
        { ...dto, course: { ...dto.course, instructorActive: false } },
        values,
        now,
      ).valid,
    ).toBe(false);
  });
  test("normalized baseline returns to pristine after edits are reset", () => {
    expect(
      normalizedParticipantDirty(
        { ...values, ci: " 001 -a ", email: " PERSON@EXAMPLE.TEST " },
        registration.participant,
      ),
    ).toBe(false);
    expect(
      normalizedParticipantDirty(
        { ...values, firstName: "Otra" },
        registration.participant,
      ),
    ).toBe(true);
    expect(normalizedParticipantDirty(values, registration.participant)).toBe(
      false,
    );
    expect(
      normalizedParticipantDirty(
        { ...values, email: "bad" },
        registration.participant,
      ),
    ).toBe(true);
  });
  test("payment and refund validity reuse server domain caps and dates", () => {
    expect(
      cashFormState(registration, "PAYMENT", dto.course.startsAt, now, values)
        .valid,
    ).toBe(true);
    expect(
      cashFormState(registration, "PAYMENT", dto.course.startsAt, now, {
        ...values,
        amount: "75.03",
      }).valid,
    ).toBe(false);
    expect(
      cashFormState(
        registration,
        "PAYMENT",
        dto.course.startsAt,
        registration.paymentDeadlineExclusive,
        values,
      ).valid,
    ).toBe(false);
    expect(
      cashFormState(registration, "REFUND", dto.course.startsAt, now, values)
        .valid,
    ).toBe(false);
    const cancelled: AdminRegistrationDto = {
      ...registration,
      state: "CANCELLED",
      membershipStatus: "CANCELADO",
      balanceCents: 0,
      refundDueCents: 2501,
      financialStatus: "REFUND_DUE",
    };
    expect(
      cashFormState(cancelled, "REFUND", dto.course.startsAt, now, values)
        .valid,
    ).toBe(true);
    expect(
      cashFormState(cancelled, "REFUND", dto.course.startsAt, now, {
        ...values,
        amount: "25.02",
      }).valid,
    ).toBe(false);
  });
  test("select SSR renders an accessible working native fallback before hydration", () => {
    const html = renderToStaticMarkup(
      createElement(RegistrationSelect, {
        id: "registration-group",
        name: "groupId",
        label: "Grupo",
        value: "a",
        error: "Revisa el grupo",
        options: [
          { value: "a", label: "Grupo A" },
          { value: "b", label: "Lleno", disabled: true },
        ],
      }),
    );
    expect(html).toContain('for="registration-group"');
    expect(html).toContain('name="groupId"');
    expect(html).toContain('required=""');
    expect(html).toContain('aria-describedby="registration-group-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('selected=""');
    expect(html).not.toContain('hidden=""');
    expect(html).not.toContain('role="combobox"');
  });
});
describe("registration client concurrency", () => {
  test("blocks duplicates pending, reuses retry key and rotates on changed payload only", () => {
    let calls = 0;
    const state = createRequestState("original", () => `new-${++calls}`);
    expect(state.begin("a")).toBe("original");
    expect(state.pending).toBe(true);
    expect(state.begin("a")).toBeNull();
    expect(state.begin("b")).toBeNull();
    state.finish();
    expect(state.begin("a")).toBe("original");
    state.finish();
    expect(state.begin("b")).toBe("new-1");
    state.finish();
    expect(state.begin("b")).toBe("new-1");
    expect(calls).toBe(1);
  });
  test("last search wins even when old adapter ignores abort", async () => {
    const search = createLatestSearch<string>();
    let finishOld!: (result: string) => void;
    let oldSignal!: AbortSignal;
    const old = search.run("old", async (_query, signal) => {
      oldSignal = signal;
      return new Promise<string>((resolve) => {
        finishOld = resolve;
      });
    });
    expect(await search.run("new", async () => "new person")).toBe(
      "new person",
    );
    expect(oldSignal.aborted).toBe(true);
    finishOld("stale private person");
    expect(await old).toBeUndefined();
  });
  test("clearing search invalidates outstanding private data", async () => {
    const search = createLatestSearch<string>();
    let finish!: (result: string) => void;
    const result = search.run(
      "CI",
      async () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    search.cancel();
    finish("private person");
    expect(await result).toBeUndefined();
  });
});
