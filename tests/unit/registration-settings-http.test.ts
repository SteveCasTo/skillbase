import { expect, test } from "bun:test";
import type { RegistrationRepository } from "@/application/pre-registrations/registration-repository";
import { updateRegistrationSettings } from "@/application/pre-registrations/manage-registrations";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import type { InternalUser } from "@/domain/auth/types";
import type { UpdateRegistrationSettingsInput } from "@/domain/pre-registrations/types";
import {
  readRegistrationSettingsForm,
  registrationSettingsErrorResponse,
} from "@/server/pre-registrations/settings-http";

const id = "00000000-0000-4000-8000-000000000001";
const admin: InternalUser = {
  id,
  authUserId: id,
  name: "Synthetic Admin",
  email: "admin@example.test",
  status: "ACTIVE",
  roles: ["ADMIN"],
};

function settingsRequest(body: Record<string, string>): Request {
  return new Request("http://localhost/app/configuracion", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

test("parses only the settings form contract and preserves raw values for SSR errors", async () => {
  const parsed = await readRegistrationSettingsForm(
    settingsRequest({
      requestKey: id,
      revision: "3",
      minimumPaymentPercent: "025",
      auxiliaryDiscountPercent: "100",
    }),
  );
  expect(parsed.values).toMatchObject({
    minimumPaymentPercent: "025",
    auxiliaryDiscountPercent: "100",
  });
  expect(parsed.input).toEqual({
    requestKey: id,
    revision: 3,
    minimumPaymentPercent: 25,
    auxiliaryDiscountPercent: 100,
  });
  await expect(
    readRegistrationSettingsForm(
      settingsRequest({
        requestKey: id,
        revision: "3",
        minimumPaymentPercent: "25",
        auxiliaryDiscountPercent: "50",
        role: "ADMIN",
      }),
    ),
  ).rejects.toThrow("Invalid registration settings form");
});

test("invalid and fractional percentages map to typed field validation errors", async () => {
  const repository = {} as RegistrationRepository;
  for (const [name, raw] of [
    ["minimumPaymentPercent", "25.5"],
    ["auxiliaryDiscountPercent", "101"],
  ] as const) {
    const { input } = await readRegistrationSettingsForm(
      settingsRequest({
        requestKey: id,
        revision: "1",
        minimumPaymentPercent: name === "minimumPaymentPercent" ? raw : "25",
        auxiliaryDiscountPercent:
          name === "auxiliaryDiscountPercent" ? raw : "50",
      }),
    );
    let caught: unknown;
    try {
      await updateRegistrationSettings(repository, admin, input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RegistrationError);
    expect(caught).toMatchObject({
      code: "VALIDATION_FAILED",
      issues: { [name]: expect.any(String) },
    });
    const response = registrationSettingsErrorResponse(caught);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_FAILED");
    expect(response.body.message).toBe("Revisa la configuración.");
    expect(response.body.fields[name]).toBeTruthy();
  }
});

test("accepts a 100 percent auxiliary discount and returns repository settings as authoritative", async () => {
  const repository = {
    updateSettings: async (
      input: UpdateRegistrationSettingsInput,
      actorId: string,
    ) => {
      expect(actorId).toBe(admin.id);
      expect(input.auxiliaryDiscountPercent).toBe(100);
      return {
        minimumPaymentPercent: input.minimumPaymentPercent,
        auxiliaryDiscountPercent: input.auxiliaryDiscountPercent,
        revision: input.revision + 1,
      };
    },
  } as unknown as RegistrationRepository;
  const { input } = await readRegistrationSettingsForm(
    settingsRequest({
      requestKey: id,
      revision: "2",
      minimumPaymentPercent: "25",
      auxiliaryDiscountPercent: "100",
    }),
  );
  expect(await updateRegistrationSettings(repository, admin, input)).toEqual({
    minimumPaymentPercent: 25,
    auxiliaryDiscountPercent: 100,
    revision: 3,
  });
});

test("preserves and serializes the optimistic revision conflict without exposing details", async () => {
  const conflict = new RegistrationError(
    "CONCURRENT_UPDATE",
    "Cambió la configuración. Recarga antes de guardar.",
  );
  const repository = {
    updateSettings: async () => {
      throw conflict;
    },
  } as unknown as RegistrationRepository;
  const { input, values } = await readRegistrationSettingsForm(
    settingsRequest({
      requestKey: id,
      revision: "1",
      minimumPaymentPercent: "30",
      auxiliaryDiscountPercent: "75",
    }),
  );
  let caught: unknown;
  try {
    await updateRegistrationSettings(repository, admin, input);
  } catch (error) {
    caught = error;
  }
  expect(values.minimumPaymentPercent).toBe("30");
  expect(values.revision).toBe("1");
  expect(registrationSettingsErrorResponse(caught)).toEqual({
    status: 409,
    body: {
      code: "CONCURRENT_UPDATE",
      message: "Cambió la configuración. Recarga antes de guardar.",
      fields: {},
    },
  });
});
