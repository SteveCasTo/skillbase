import { expect, test } from "bun:test";
import type { InternalUser } from "@/domain/auth/types";
import type {
  CreateRegistrationInput,
  RecordCashInput,
} from "@/domain/pre-registrations/types";
import type { RegistrationRepository } from "@/application/pre-registrations/registration-repository";
import {
  cancelRegistration,
  createRegistration,
  findParticipants,
  getInstructorRoster,
  getRegistrationDetail,
  getRegistrationForm,
  getRegistrationSettings,
  listRegistrations,
  recordRegistrationPayment,
  recordRegistrationRefund,
  transferRegistration,
  updateParticipant,
  updateRegistrationSettings,
  validateRegistrationFilter,
  validateRegistrationReason,
} from "@/application/pre-registrations/manage-registrations";

const id = "00000000-0000-4000-8000-000000000001";
const revision = "2099-02-01T12:00:00.000Z";
const admin: InternalUser = {
  id,
  authUserId: id,
  name: "Synthetic Admin",
  email: "admin@test.invalid",
  status: "ACTIVE",
  roles: ["ADMIN"],
};
const now = new Date(revision);
const cash: RecordCashInput = {
  requestKey: id,
  registrationId: id,
  revision,
  cash: { amountCents: 2001, effectiveDate: null, reason: "Cash" },
};
const input: CreateRegistrationInput = {
  requestKey: id,
  courseId: id,
  groupId: id,
  participant: {
    ci: " 00 ab-X ",
    firstName: " Synthetic ",
    lastName: " Participant ",
    email: " PERSON@TEST.INVALID ",
    phone: null,
  },
  participantType: "STUDENT",
  courseRevision: revision,
  settingsRevision: 1,
  sourceInterestId: null,
  firstDayException: false,
  initialPayment: cash.cash,
};
const sentinel = new Error("repository called");
async function fail(): Promise<never> {
  throw sentinel;
}
const repository: RegistrationRepository = {
  form: fail,
  create: fail,
  updateParticipant: fail,
  recordPayment: fail,
  recordRefund: fail,
  cancel: fail,
  transfer: fail,
  settings: fail,
  updateSettings: fail,
  list: fail,
  detail: fail,
  findParticipants: fail,
  instructorRoster: fail,
};

test("all administrative use cases authorize before touching the repository or validating PII", async () => {
  for (const actor of [
    null,
    { ...admin, status: "DISABLED" as const },
    { ...admin, roles: ["INSTRUCTOR" as const] },
  ]) {
    const operations = [
      () => getRegistrationForm(repository, actor, id),
      () => createRegistration(repository, actor, input, now),
      () =>
        updateParticipant(repository, actor, {
          requestKey: id,
          participantId: id,
          revision,
          participant: input.participant,
        }),
      () => recordRegistrationPayment(repository, actor, cash, now),
      () => recordRegistrationRefund(repository, actor, cash, now),
      () =>
        cancelRegistration(
          repository,
          actor,
          { ...cash, reason: "Cancel", refundedNow: null },
          now,
        ),
      () =>
        transferRegistration(repository, actor, {
          ...cash,
          destinationGroupId: id,
        }),
      () => getRegistrationSettings(repository, actor),
      () =>
        updateRegistrationSettings(repository, actor, {
          requestKey: id,
          revision: 1,
          minimumPaymentPercent: 25,
          auxiliaryDiscountPercent: 50,
        }),
      () => listRegistrations(repository, actor, { page: 1, pageSize: 20 }),
      () => getRegistrationDetail(repository, actor, id),
      () => findParticipants(repository, actor, "Synthetic"),
    ];
    for (const operation of operations)
      await expect(operation()).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
});
test("create orchestration passes normalized contract fields and server actor only", async () => {
  let received: CreateRegistrationInput | undefined;
  let actorId: string | undefined;
  const adapter: RegistrationRepository = {
    ...repository,
    create: async (value, actor) => {
      received = value;
      actorId = actor;
      throw sentinel;
    },
  };
  await expect(
    createRegistration(
      adapter,
      admin,
      {
        ...input,
        actorId: "untrusted",
        participant: { ...input.participant, injected: true },
        irrelevant: true,
      },
      now,
    ),
  ).rejects.toBe(sentinel);
  expect(actorId).toBe(admin.id);
  expect(received!.participant).toEqual({
    ci: "00AB-X",
    firstName: "Synthetic",
    lastName: "Participant",
    email: "person@test.invalid",
    phone: null,
  });
  expect(Object.keys(received!)).not.toContain("actorId");
  expect(Object.keys(received!.participant)).not.toContain("injected");
});
test("payment orchestration rejects future cash and invalid optimistic revision before persistence", async () => {
  await expect(
    recordRegistrationPayment(
      repository,
      admin,
      { ...cash, cash: { amountCents: 2001, effectiveDate: null } },
      now,
    ),
  ).rejects.toBe(sentinel);
  await expect(
    recordRegistrationRefund(
      repository,
      admin,
      { ...cash, cash: { amountCents: 2001, effectiveDate: null } },
      now,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(
    recordRegistrationPayment(
      repository,
      admin,
      { ...cash, cash: { ...cash.cash, effectiveDate: "2099-02-02" } },
      now,
    ),
  ).rejects.toMatchObject({
    code: "VALIDATION_FAILED",
    issues: { effectiveDate: expect.any(String) },
  });
  await expect(
    recordRegistrationPayment(
      repository,
      admin,
      { ...cash, revision: "stale" },
      now,
    ),
  ).rejects.toMatchObject({
    code: "VALIDATION_FAILED",
    issues: { revision: expect.any(String) },
  });
  await expect(
    recordRegistrationRefund(
      repository,
      admin,
      { ...cash, cash: { ...cash.cash, amountCents: 0 } },
      now,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
test("settings orchestration validates percentages and does not carry unknown input fields", async () => {
  await expect(
    updateRegistrationSettings(repository, admin, {
      requestKey: id,
      revision: 1,
      minimumPaymentPercent: 101,
      auxiliaryDiscountPercent: 50,
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const adapter: RegistrationRepository = {
    ...repository,
    updateSettings: async (value, actorId) => {
      expect(actorId).toBe(admin.id);
      expect(Object.keys(value).sort()).toEqual([
        "auxiliaryDiscountPercent",
        "minimumPaymentPercent",
        "requestKey",
        "revision",
      ]);
      return {
        revision: 2,
        minimumPaymentPercent: value.minimumPaymentPercent,
        auxiliaryDiscountPercent: value.auxiliaryDiscountPercent,
      };
    },
  };
  expect(
    await updateRegistrationSettings(adapter, admin, {
      requestKey: id,
      revision: 1,
      minimumPaymentPercent: 25,
      auxiliaryDiscountPercent: 100,
    }),
  ).toMatchObject({ revision: 2, auxiliaryDiscountPercent: 100 });
});
test("lists bound pagination and enforce known projection filters", () => {
  for (const filter of [
    { page: 0, pageSize: 20 },
    { page: 1001, pageSize: 20 },
    { page: 1, pageSize: 101 },
    { page: 1.5, pageSize: 20 },
    { page: 1, pageSize: 20, search: "x".repeat(201) },
  ])
    expect(() => validateRegistrationFilter(filter)).toThrow();
  expect(
    validateRegistrationFilter({
      page: 1,
      pageSize: 20,
      search: " Synthetic ",
      financialStatus: "REFUND_DUE",
      membershipStatus: "CANCELADO",
    }).search,
  ).toBe("Synthetic");
});
test("cancel orchestration validates motive and preserves explicit pending liability", async () => {
  expect(validateRegistrationReason(" Reason ")).toBe("Reason");
  for (const reason of [" ", "bad\nreason", "x".repeat(501)])
    expect(() => validateRegistrationReason(reason)).toThrow();
  const adapter: RegistrationRepository = {
    ...repository,
    cancel: async (value) => {
      expect(value.refundedNow).toBeNull();
      expect(value.reason).toBe("Reason");
      throw sentinel;
    },
  };
  await expect(
    cancelRegistration(
      adapter,
      admin,
      { ...cash, reason: " Reason ", refundedNow: null },
      now,
    ),
  ).rejects.toBe(sentinel);
});
test("instructor application entry cannot elevate ADMIN-only or inactive actors", async () => {
  await expect(
    getInstructorRoster(repository, admin, id, id),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    getInstructorRoster(
      repository,
      { ...admin, roles: ["INSTRUCTOR"], status: "DISABLED" },
      id,
      id,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    getInstructorRoster(
      repository,
      { ...admin, roles: ["INSTRUCTOR"] },
      id,
      id,
    ),
  ).rejects.toBe(sentinel);
});
