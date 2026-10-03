import { expect, test } from "bun:test";
import {
  requireRegistrationAdmin,
  requireInstructorRosterAccess,
} from "@/application/pre-registrations/authorization";
import type { InternalUser } from "@/domain/auth/types";
import {
  createPriceSnapshot,
  centsToDecimal,
  decimalToCents,
  assertCents,
  validateSettings,
  DEFAULT_REGISTRATION_SETTINGS,
} from "@/domain/pre-registrations/money";
import {
  normalizeParticipantCi,
  validateParticipant,
} from "@/domain/pre-registrations/participant";
import {
  registrationFinance,
  assertRefund,
} from "@/domain/pre-registrations/finance";
import {
  assertRegistrationPayment,
  assertEligibleDestination,
  assertAdditionalPayment,
  assertCancellation,
  assertTransfer,
  membershipStatus,
  normalRegistrationOpen,
} from "@/domain/pre-registrations/policies";
import {
  boliviaToday,
  firstDayDeadlineExclusive,
  validateCashEffectiveDate,
} from "@/domain/pre-registrations/time";
import {
  validateCashInput,
  validateCreateRegistration,
  validateRegistrationRevision,
} from "@/domain/pre-registrations/validation";
import type {
  RegistrationCourseContext,
  RegistrationGroupContext,
  RegistrationParticipantType,
} from "@/domain/pre-registrations/types";

const id = "00000000-0000-4000-8000-000000000001";
const course: RegistrationCourseContext = {
  id,
  status: "PUBLISHED",
  startsAt: new Date("2099-03-02T04:00:00Z"),
  registrationEndAt: new Date("2099-03-01T04:00:00Z"),
  instructorActive: true,
  courseTypeRevisionId: id,
  studentAmount: "80.01",
  externalAmount: "100.00",
};
const group: RegistrationGroupContext = {
  id,
  courseId: id,
  courseTypeRevisionId: id,
  status: "PLANNED",
  capacity: 1,
  occupied: 0,
};
const before = new Date("2099-02-28T20:00:00Z");
function snapshot(
  type: RegistrationParticipantType = "STUDENT",
  discount = 50,
  studentAmount = course.studentAmount,
) {
  return createPriceSnapshot({
    participantType: type,
    courseTypeRevisionId: id,
    studentAmount,
    externalAmount: course.externalAmount,
    settings: {
      ...DEFAULT_REGISTRATION_SETTINGS,
      auxiliaryDiscountPercent: discount,
    },
  });
}
const participant = {
  ci: " 00 ab - lp ",
  firstName: " María José ",
  lastName: " Test 李 ",
  email: "PERSON@Example.invalid",
  phone: null,
};

test("phase5 application authorization requires active ADMIN; instructor roster is owned and start-gated", () => {
  const actor: InternalUser = {
    id,
    authUserId: id,
    email: "synthetic@example.invalid",
    name: "Test",
    status: "ACTIVE",
    roles: ["ADMIN", "INSTRUCTOR"],
  };
  expect(() => requireRegistrationAdmin(actor)).not.toThrow();
  expect(() => requireRegistrationAdmin(null)).toThrow();
  expect(() =>
    requireRegistrationAdmin({ ...actor, status: "DISABLED" }),
  ).toThrow();
  expect(() =>
    requireRegistrationAdmin({ ...actor, status: "INVITED" }),
  ).toThrow();
  expect(() =>
    requireRegistrationAdmin({ ...actor, roles: ["INSTRUCTOR"] }),
  ).toThrow();
  expect(() =>
    requireInstructorRosterAccess(actor, id, course.startsAt, course.startsAt),
  ).not.toThrow();
  expect(() =>
    requireInstructorRosterAccess(
      actor,
      "other",
      course.startsAt,
      course.startsAt,
    ),
  ).toThrow();
  expect(() =>
    requireInstructorRosterAccess(actor, id, course.startsAt, before),
  ).toThrow();
  expect(() =>
    requireInstructorRosterAccess(
      { ...actor, roles: ["ADMIN"] },
      id,
      course.startsAt,
      course.startsAt,
    ),
  ).toThrow();
  expect(() =>
    requireInstructorRosterAccess(
      { ...actor, status: "DISABLED" },
      id,
      course.startsAt,
      course.startsAt,
    ),
  ).toThrow();
});

test("phase5 CI normalization preserves leading zeroes, letters and suffixes without email identity", () => {
  expect(normalizeParticipantCi(participant.ci)).toBe("00AB-LP");
  expect(normalizeParticipantCi("0000123 a")).toBe("0000123A");
  expect(normalizeParticipantCi("\u00a000 AB\u00a0")).toBe("00AB");
  expect(validateParticipant(participant)).toEqual({
    ci: "00AB-LP",
    firstName: "María José",
    lastName: "Test 李",
    email: "person@example.invalid",
    phone: null,
  });
  expect(validateParticipant({ ...participant, ci: "A" })).toMatchObject({
    ci: "A",
  });
});
test.each([
  {},
  { ...participant, ci: 123 },
  { ...participant, ci: " " },
  { ...participant, email: "no-email" },
  { ...participant, firstName: "\nName" },
  { ...participant, phone: 12 },
  { ...participant, ci: "a".repeat(65) },
])("phase5 participant rejects invalid/unsafe fields %#", (input) => {
  expect(() => validateParticipant(input)).toThrow();
});
test.each(["0", "0.01", "80.10", "9999999999.99"])(
  "phase5 decimal cents round-trip %s",
  (value) => {
    expect(decimalToCents(centsToDecimal(decimalToCents(value)))).toBe(
      decimalToCents(value),
    );
  },
);
test.each(["1e2", "1.001", "-1", "10000000000.00", "NaN"])(
  "phase5 rejects unsafe decimal %s",
  (value) => {
    expect(() => decimalToCents(value)).toThrow();
  },
);
test.each([Number.MAX_SAFE_INTEGER + 1, 1.5, -1, Infinity, 1_000_000_000_000])(
  "phase5 rejects unsafe cents %s",
  (value) => {
    expect(() => assertCents(value)).toThrow();
  },
);
test("phase5 snapshot uses exact half-up final discount and ceil minimum, frozen across changes", () => {
  expect(snapshot()).toMatchObject({
    totalPriceCents: 8001,
    minimumPaymentCents: 2001,
    discountPercent: 0,
  });
  expect(snapshot("EXTERNAL")).toMatchObject({
    basePriceCents: 10000,
    totalPriceCents: 10000,
    minimumPaymentCents: 2500,
  });
  const auxiliary = snapshot("AUXILIARY");
  expect(auxiliary).toMatchObject({
    basePriceCents: 8001,
    totalPriceCents: 4001,
    minimumPaymentCents: 1001,
  });
  expect(Object.isFrozen(auxiliary)).toBe(true);
  expect(snapshot("AUXILIARY", 100)).toMatchObject({
    totalPriceCents: 0,
    minimumPaymentCents: 0,
  });
  expect(snapshot("AUXILIARY", 0)).toMatchObject({
    totalPriceCents: 8001,
    minimumPaymentCents: 2001,
  });
  expect(auxiliary.totalPriceCents).toBe(4001);
});
test("phase5 largest supported tariff avoids floating intermediates", () => {
  const price = snapshot("AUXILIARY", 50, "9999999999.99");
  expect(price.totalPriceCents).toBe(500_000_000_000);
  expect(price.minimumPaymentCents).toBe(125_000_000_000);
});
test.each([0, 101, 25.5])(
  "phase5 minimum percent rejects %s",
  (minimumPaymentPercent) => {
    expect(() =>
      validateSettings({
        ...DEFAULT_REGISTRATION_SETTINGS,
        minimumPaymentPercent,
      }),
    ).toThrow();
  },
);
test.each([-1, 101, 50.5])(
  "phase5 auxiliary percent rejects %s",
  (auxiliaryDiscountPercent) => {
    expect(() =>
      validateSettings({
        ...DEFAULT_REGISTRATION_SETTINGS,
        auxiliaryDiscountPercent,
      }),
    ).toThrow();
  },
);
test("phase5 percent boundaries and existing zero tariffs allow legitimate free registrations", () => {
  expect(
    validateSettings({
      minimumPaymentPercent: 100,
      auxiliaryDiscountPercent: 100,
      revision: 1,
    }),
  ).toBeDefined();
  const free = snapshot("STUDENT", 50, "0.00");
  expect(() =>
    assertRegistrationPayment(course, free, null, false, before),
  ).not.toThrow();
  expect(() =>
    assertRegistrationPayment(course, free, 0, false, before),
  ).toThrow();
  expect(registrationFinance(free, "ACTIVE", [])).toMatchObject({
    financialStatus: "EXEMPT",
    balanceCents: 0,
  });
});
test("phase5 initial payment enforces rounded minimum and no overpayment", () => {
  const price = snapshot();
  expect(() =>
    assertRegistrationPayment(course, price, 2001, false, before),
  ).not.toThrow();
  expect(() =>
    assertRegistrationPayment(course, price, 2000, false, before),
  ).toThrow();
  expect(() =>
    assertRegistrationPayment(course, price, null, false, before),
  ).toThrow();
  expect(() =>
    assertRegistrationPayment(course, price, 8002, false, before),
  ).toThrow();
});
test("phase5 exclusive cutoff preserves precise legacy windows and publication opening", () => {
  expect(normalRegistrationOpen(course, before)).toBe(true);
  expect(normalRegistrationOpen(course, course.registrationEndAt!)).toBe(false);
  expect(
    normalRegistrationOpen(
      { ...course, registrationEndAt: null },
      course.startsAt,
    ),
  ).toBe(false);
  expect(normalRegistrationOpen({ ...course, status: "DRAFT" }, before)).toBe(
    false,
  );
});
test("phase5 first-day exception requires explicit total payment and cannot extend to next day", () => {
  const first = new Date("2099-03-03T03:59:59.999Z");
  expect(() =>
    assertRegistrationPayment(course, snapshot(), 8001, true, first),
  ).not.toThrow();
  expect(() =>
    assertRegistrationPayment(course, snapshot(), 2001, true, first),
  ).toThrow();
  expect(() =>
    assertRegistrationPayment(course, snapshot(), 8001, true, before),
  ).toThrow();
  expect(() =>
    assertRegistrationPayment(
      course,
      snapshot(),
      8001,
      true,
      new Date("2099-03-03T04:00:00Z"),
    ),
  ).toThrow();
  expect(() =>
    assertRegistrationPayment(
      course,
      snapshot("AUXILIARY", 100),
      null,
      true,
      first,
    ),
  ).not.toThrow();
});
test("phase5 eligibility checks published course, active instructor, same-course planned group and seat", () => {
  expect(() => assertEligibleDestination(course, group)).not.toThrow();
  expect(() =>
    assertEligibleDestination({ ...course, status: "ARCHIVED" }, group),
  ).toThrow();
  expect(() =>
    assertEligibleDestination({ ...course, instructorActive: false }, group),
  ).toThrow();
  expect(() =>
    assertEligibleDestination(course, { ...group, occupied: 1 }),
  ).toThrow();
  expect(() =>
    assertEligibleDestination(course, { ...group, courseId: "other" }),
  ).toThrow();
  expect(() =>
    assertEligibleDestination(course, { ...group, status: "CANCELLED" }),
  ).toThrow();
});
test("phase5 membership derives start, paid and first-day overdue without auto cancellation", () => {
  const deadline = firstDayDeadlineExclusive(course.startsAt);
  expect(deadline.toISOString()).toBe("2099-03-03T04:00:00.000Z");
  expect(membershipStatus("ACTIVE", 0, course.startsAt, before)).toBe(
    "PREINSCRITO",
  );
  expect(membershipStatus("ACTIVE", 0, course.startsAt, course.startsAt)).toBe(
    "INSCRITO",
  );
  expect(
    membershipStatus(
      "ACTIVE",
      1,
      course.startsAt,
      new Date(deadline.getTime() - 1),
    ),
  ).toBe("PREINSCRITO");
  expect(membershipStatus("ACTIVE", 1, course.startsAt, deadline)).toBe(
    "SALDOVENCIDO",
  );
  expect(membershipStatus("CANCELLED", 1, course.startsAt, before)).toBe(
    "CANCELADO",
  );
});
test("phase5 late payments deny ordinary admin backdoor after first day, but allow regularization when window closed", () => {
  const finance = registrationFinance(snapshot(), "ACTIVE", [
    { kind: "PAYMENT", amountCents: 2001 },
  ]);
  expect(() =>
    assertAdditionalPayment(
      "ACTIVE",
      finance,
      6000,
      course.startsAt,
      course.startsAt,
    ),
  ).not.toThrow();
  expect(() =>
    assertAdditionalPayment(
      "ACTIVE",
      finance,
      6001,
      course.startsAt,
      course.startsAt,
    ),
  ).toThrow();
  expect(() =>
    assertAdditionalPayment(
      "ACTIVE",
      finance,
      1,
      course.startsAt,
      firstDayDeadlineExclusive(course.startsAt),
    ),
  ).toThrow();
  expect(() =>
    assertAdditionalPayment("CANCELLED", finance, 1, course.startsAt, before),
  ).toThrow();
});
test("phase5 financial projection preserves liability on cancellation and explicit cash refund", () => {
  const price = snapshot();
  const entries = [{ kind: "PAYMENT" as const, amountCents: 2001 }];
  const cancelled = registrationFinance(price, "CANCELLED", entries);
  expect(cancelled).toMatchObject({
    financialStatus: "REFUND_DUE",
    refundDueCents: 2001,
    paidCents: 2001,
  });
  expect(() => assertRefund("CANCELLED", cancelled, 2001)).not.toThrow();
  expect(() => assertRefund("CANCELLED", cancelled, 2002)).toThrow();
  expect(() => assertRefund("ACTIVE", cancelled, 1)).toThrow();
  expect(
    registrationFinance(price, "CANCELLED", [
      ...entries,
      { kind: "REFUND", amountCents: 2001 },
    ]),
  ).toMatchObject({
    financialStatus: "REFUNDED",
    refundDueCents: 0,
    paidCents: 2001,
    refundedCents: 2001,
  });
  expect(
    registrationFinance(snapshot("AUXILIARY", 100), "CANCELLED", []),
  ).toMatchObject({ financialStatus: "EXEMPT", refundDueCents: 0 });
});
test("phase5 financial projection rejects zero cash, overpay, overrefund and active refund", () => {
  expect(() =>
    registrationFinance(snapshot(), "ACTIVE", [
      { kind: "PAYMENT", amountCents: 0 },
    ]),
  ).toThrow();
  expect(() =>
    registrationFinance(snapshot(), "ACTIVE", [
      { kind: "PAYMENT", amountCents: 8002 },
    ]),
  ).toThrow();
  expect(() =>
    registrationFinance(snapshot(), "CANCELLED", [
      { kind: "REFUND", amountCents: 1 },
    ]),
  ).toThrow();
  expect(() =>
    registrationFinance(snapshot(), "ACTIVE", [
      { kind: "PAYMENT", amountCents: 2001 },
      { kind: "REFUND", amountCents: 1 },
    ]),
  ).toThrow();
});
test("phase5 voluntary cutoff and group cancellation have distinct policies", () => {
  expect(() =>
    assertCancellation(course, "ACTIVE", "VOLUNTARY", before),
  ).not.toThrow();
  expect(() =>
    assertCancellation(
      course,
      "ACTIVE",
      "VOLUNTARY",
      course.registrationEndAt!,
    ),
  ).toThrow();
  expect(() =>
    assertCancellation(
      course,
      "ACTIVE",
      "GROUP_CANCELLED",
      new Date("2100-01-01Z"),
    ),
  ).not.toThrow();
  expect(() => assertTransfer(course, "ACTIVE", group, before)).not.toThrow();
  expect(() =>
    assertTransfer(course, "ACTIVE", group, course.registrationEndAt!),
  ).toThrow();
  expect(() =>
    assertTransfer(course, "ACTIVE", { ...group, courseId: "other" }, before),
  ).toThrow();
});
test("phase5 cash date is civil Bolivia, strict and no future dates", () => {
  const now = new Date("2099-03-03T03:59:59Z");
  expect(boliviaToday(now)).toBe("2099-03-02");
  expect(validateCashEffectiveDate(null, now)).toBe("2099-03-02");
  expect(validateCashEffectiveDate("2099-02-28", now)).toBe("2099-02-28");
  expect(() => validateCashEffectiveDate("2099-03-03", now)).toThrow();
  expect(() => validateCashEffectiveDate("2099-02-30", now)).toThrow();
  expect(() => validateCashEffectiveDate("2099-3-2", now)).toThrow();
});
test("phase5 command validation preserves null default cash date for stable retry fingerprints", () => {
  expect(
    validateCashInput(
      { amountCents: 1, reason: " Cash ", effectiveDate: null },
      before,
    ),
  ).toEqual({ amountCents: 1, reason: "Cash", effectiveDate: null });
  const input = {
    requestKey: id,
    courseId: id,
    groupId: id,
    participant,
    participantType: "STUDENT",
    settingsRevision: 1,
    courseRevision: before.toISOString(),
    firstDayException: false,
    sourceInterestId: null,
    initialPayment: { amountCents: 2001, reason: "Cash", effectiveDate: null },
  };
  expect(validateCreateRegistration(input, before)).toMatchObject({
    participant: { ci: "00AB-LP" },
    initialPayment: { effectiveDate: null },
  });
  expect(() =>
    validateCreateRegistration({ ...input, requestKey: "invalid" }, before),
  ).toThrow();
  expect(() =>
    validateRegistrationRevision("2099-02-30T00:00:00.000Z"),
  ).toThrow();
  expect(() =>
    validateCashInput({ amountCents: 1.5, reason: "Cash" }, before),
  ).toThrow();
});
