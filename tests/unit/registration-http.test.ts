import { describe, expect, test } from "bun:test";
import {
  cashFromRegistrationValues,
  flatRegistrationValues,
  handleRegistrationPost,
  parseRegistrationFilter,
  registrationFailure,
  registrationJson,
} from "@/server/pre-registrations/http";
import { getPrivateRoutePolicy } from "@/server/auth/route-policy";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import { RegistrationPdfTextError } from "@/server/pre-registrations/exports/pdf";
import { navigationSkeletonVariant } from "@/components/private-nav/navigation-skeleton";
import type { RegistrationRepository } from "@/application/pre-registrations/registration-repository";
import type {
  CreateRegistrationInput,
  AdminRegistrationDto,
  RegistrationDetailDto,
} from "@/domain/pre-registrations/types";
import type { InternalUser } from "@/domain/auth/types";
import {
  createPriceSnapshot,
  DEFAULT_REGISTRATION_SETTINGS,
} from "@/domain/pre-registrations/money";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const revision = "2099-02-01T12:00:00.000Z";
const now = new Date(revision);
const siteUrl = new URL("http://127.0.0.1:4999");
const actor: InternalUser = {
  id,
  authUserId: id,
  name: "Synthetic Admin",
  email: "admin@test.invalid",
  status: "ACTIVE",
  roles: ["ADMIN"],
};
const values = {
  requestKey: id,
  courseId: id,
  groupId: id,
  courseRevision: revision,
  settingsRevision: "1",
  participantType: "STUDENT",
  ci: "00 A-x",
  firstName: "Synthetic",
  lastName: "Person",
  email: "person@test.invalid",
  phone: "",
  amount: "25.50",
  effectiveDate: "2099-02-01",
  reason: "Efectivo",
};
const registration: AdminRegistrationDto = {
  id,
  courseId: id,
  groupId: id,
  participant: {
    id,
    revision,
    ci: "00A-X",
    firstName: "Synthetic",
    lastName: "Person",
    email: "person@test.invalid",
    phone: null,
  },
  price: createPriceSnapshot({
    participantType: "STUDENT",
    courseTypeRevisionId: id,
    studentAmount: "100",
    externalAmount: "150",
    settings: DEFAULT_REGISTRATION_SETTINGS,
  }),
  state: "ACTIVE",
  membershipStatus: "PREINSCRITO",
  sourceInterestId: null,
  firstDayException: false,
  cancellationReason: null,
  cancelledAt: null,
  revision,
  createdAt: revision,
  paymentDeadlineExclusive: "2099-03-01T04:00:00.000Z",
  paidCents: 2550,
  refundedCents: 0,
  balanceCents: 7450,
  refundDueCents: 0,
  financialStatus: "PARTIAL",
};
const detail: RegistrationDetailDto = { registration, ledger: [] };
async function fail(): Promise<never> {
  throw new Error("Unexpected repository call");
}
function repository(
  overrides: Partial<RegistrationRepository> = {},
): RegistrationRepository {
  return {
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
    ...overrides,
  };
}
function request(form: Record<string, string>, origin = siteUrl.origin) {
  return new Request(`${siteUrl.origin}/app/preinscripciones/nueva`, {
    method: "POST",
    headers: { Origin: origin },
    body: new URLSearchParams(form),
  });
}
describe("registration HTTP contracts", () => {
  test("decimal BOB is converted once to integer cents and legacy cents form fields are rejected", async () => {
    expect(
      cashFromRegistrationValues({ ...values, amount: "25.50" }).amountCents,
    ).toBe(2550);
    expect(
      cashFromRegistrationValues({ ...values, amount: "0,01" }).amountCents,
    ).toBe(1);
    expect(() =>
      cashFromRegistrationValues({ ...values, amount: "0.001" }),
    ).toThrow();
    let captured: CreateRegistrationInput | undefined;
    const result = await handleRegistrationPost({
      request: request(values),
      actor,
      siteUrl,
      operation: "create",
      now,
      repository: repository({
        create: async (input) => {
          captured = input;
          return registration;
        },
      }),
    });
    expect(result.payload.ok).toBe(true);
    expect(captured?.initialPayment?.amountCents).toBe(2550);
    expect(captured?.participant.ci).toBe("00A-X");
    const legacy = await handleRegistrationPost({
      request: request({ ...values, amountCents: "2550" }),
      actor,
      siteUrl,
      operation: "create",
      now,
      repository: repository(),
    });
    expect(legacy.status).toBe(422);
  });
  test("free form omitted amount creates no initial payment, never zero ledger cash", async () => {
    const { amount, ...free } = values;
    expect(amount).toBe("25.50");
    let captured: CreateRegistrationInput | undefined;
    const result = await handleRegistrationPost({
      request: request({ ...free, participantType: "AUXILIARY" }),
      actor,
      siteUrl,
      operation: "create",
      now,
      repository: repository({
        create: async (input) => {
          captured = input;
          return registration;
        },
      }),
    });
    expect(result.payload.ok).toBe(true);
    expect(captured?.initialPayment).toBeNull();
    const zero = await handleRegistrationPost({
      request: request({ ...values, amount: "0" }),
      actor,
      siteUrl,
      operation: "create",
      now,
      repository: repository(),
    });
    expect(zero.status).toBe(422);
    expect(zero.payload).toMatchObject({
      ok: false,
      issues: { amount: expect.any(String) },
    });
  });
  test("payment, refund and cancellation keep domain DTOs and actual cash semantics", async () => {
    const mutation = {
      requestKey: id,
      registrationId: id,
      revision,
      amount: "0.01",
      effectiveDate: "2099-02-01",
      reason: "Cash",
    };
    for (const operation of ["payment", "refund"] as const) {
      const result = await handleRegistrationPost({
        request: request(mutation),
        actor,
        siteUrl,
        now,
        registrationId: id,
        operation,
        repository: repository({
          recordPayment: async (input) => {
            expect(input.cash.amountCents).toBe(1);
            return detail;
          },
          recordRefund: async (input) => {
            expect(input.cash.amountCents).toBe(1);
            return detail;
          },
        }),
      });
      expect(result.payload).toMatchObject({
        ok: true,
        value: { kind: "detail", detail },
      });
    }
    const result = await handleRegistrationPost({
      request: request(mutation),
      actor,
      siteUrl,
      now,
      registrationId: id,
      operation: "cancel",
      repository: repository({
        cancel: async (input) => {
          expect(input.refundedNow).toBeNull();
          return detail;
        },
      }),
    });
    expect(result.payload.ok).toBe(true);
  });
  test("body/origin/role checks precede commands and reject repeated fields", async () => {
    const base = {
      actor,
      siteUrl,
      now,
      operation: "create" as const,
      repository: repository(),
    };
    expect(
      (
        await handleRegistrationPost({
          ...base,
          request: request(values, "https://attacker.invalid"),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await handleRegistrationPost({
          ...base,
          actor: { ...actor, roles: ["INSTRUCTOR"] },
          request: request(values),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await handleRegistrationPost({
          ...base,
          request: new Request(siteUrl, {
            method: "POST",
            headers: {
              Origin: siteUrl.origin,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "requestKey=a&requestKey=b",
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await handleRegistrationPost({
          ...base,
          request: new Request(siteUrl, {
            method: "POST",
            headers: {
              Origin: siteUrl.origin,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "x=" + "a".repeat(16385),
          }),
        })
      ).status,
    ).toBe(413);
    expect(() => flatRegistrationValues({ amount: 25.5 })).toThrow();
    expect(() =>
      flatRegistrationValues({ password: "never-reflect-credentials" }),
    ).toThrow();
  });
  test("URL ownership, UUID, date and revisions are validated and attempted values survive rejection", async () => {
    const base = {
      actor,
      siteUrl,
      now,
      operation: "payment" as const,
      repository: repository(),
      registrationId: id,
    };
    expect(
      (
        await handleRegistrationPost({
          ...base,
          request: request({ ...values, registrationId: other, revision }),
        })
      ).status,
    ).toBe(422);
    const attempted = {
      ...values,
      requestKey: "not-uuid",
      registrationId: id,
      revision,
    };
    const result = await handleRegistrationPost({
      ...base,
      request: request(attempted),
    });
    expect(result.values).toEqual(attempted);
    expect(result.status).toBe(422);
    const future = await handleRegistrationPost({
      ...base,
      request: request({
        ...values,
        registrationId: id,
        revision,
        effectiveDate: "2099-02-02",
      }),
    });
    expect(future.payload).toMatchObject({
      ok: false,
      issues: { effectiveDate: expect.any(String) },
    });
  });
  test("typed financial errors target amount while unknown infrastructure errors leak no details", () => {
    const pdf = registrationFailure(new RegistrationPdfTextError());
    expect(pdf.status).toBe(422);
    expect(pdf.payload.code).toBe("PDF_UNSUPPORTED_TEXT");
    expect(pdf.payload.message).toContain("CSV");
    expect(
      registrationFailure(
        new RegistrationError(
          "PAYMENT_EXCEEDS_BALANCE",
          "El monto supera el saldo.",
          { amountCents: "Revisa el importe." },
        ),
      ).payload.issues,
    ).toEqual({ amount: "Revisa el importe." });
    const failure = registrationFailure(
      new Error("password=secret SQL SELECT private"),
    );
    expect(JSON.stringify(failure)).not.toContain("secret");
    expect(failure.status).toBe(503);
    const response = registrationJson(failure.payload, failure.status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  test("filters and route policies reject malformed paths and protect all administrative surfaces", () => {
    expect(
      parseRegistrationFilter(
        new URLSearchParams("search=Person&membershipStatus=PREINSCRITO"),
      ),
    ).toEqual({
      page: 1,
      pageSize: 20,
      search: "Person",
      membershipStatus: "PREINSCRITO",
    });
    for (const query of [
      "courseId=invalid",
      "page=-1",
      "page=1&page=2",
      "financialStatus=FAKE",
    ])
      expect(() =>
        parseRegistrationFilter(new URLSearchParams(query)),
      ).toThrow();
    for (const path of [
      "/app/preinscripciones",
      "/app/preinscripciones/nueva",
      "/app/preinscripciones/buscar",
      "/app/preinscripciones/exportar",
      `/app/preinscripciones/${id}`,
      "/app/participantes",
      `/app/participantes/${id}`,
      "/app/configuracion",
    ])
      expect(getPrivateRoutePolicy(path)).toEqual({
        access: "ROLES",
        roles: ["ADMIN"],
      });
    expect(
      getPrivateRoutePolicy(`/app/mis-cursos/${id}/grupos/${other}`),
    ).toEqual({ access: "ROLES", roles: ["INSTRUCTOR"] });
    expect(getPrivateRoutePolicy("/app/preinscripciones/not-an-id")).toBeNull();
    expect(navigationSkeletonVariant("/app/preinscripciones")).toBe("list");
    expect(navigationSkeletonVariant("/app/preinscripciones/nueva")).toBe(
      "form",
    );
    expect(navigationSkeletonVariant(`/app/preinscripciones/${id}`)).toBe(
      "detail",
    );
    expect(navigationSkeletonVariant(`/app/participantes/${id}`)).toBe("form");
    expect(
      navigationSkeletonVariant(`/app/mis-cursos/${id}/grupos/${other}`),
    ).toBe("list");
  });
});
