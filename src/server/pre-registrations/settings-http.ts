import type { UpdateRegistrationSettingsInput } from "@/domain/pre-registrations/types";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import { readAuthForm } from "@/server/auth/security";

const SETTINGS_FORM_FIELDS = new Set([
  "requestKey",
  "revision",
  "minimumPaymentPercent",
  "auxiliaryDiscountPercent",
]);

export class InvalidRegistrationSettingsFormError extends Error {
  constructor() {
    super("Invalid registration settings form");
    this.name = "InvalidRegistrationSettingsFormError";
  }
}

export interface RegistrationSettingsFormSubmission {
  readonly input: UpdateRegistrationSettingsInput;
  readonly values: Readonly<Record<string, string>>;
}

export function registrationSettingsErrorResponse(error: unknown): {
  readonly status: number;
  readonly body: {
    readonly code: string;
    readonly message: string;
    readonly fields: Readonly<Record<string, string>>;
  };
} {
  if (!(error instanceof RegistrationError))
    return {
      status: 500,
      body: {
        code: "REQUEST_FAILED",
        message: "No se pudo guardar la configuración. Inténtalo nuevamente.",
        fields: {},
      },
    };
  const status =
    error.code === "FORBIDDEN"
      ? 403
      : error.code === "NOT_FOUND"
        ? 404
        : error.code === "CONCURRENT_UPDATE" ||
            error.code === "IDEMPOTENCY_CONFLICT"
          ? 409
          : 400;
  return {
    status,
    body: {
      code: error.code,
      message: error.message,
      fields: error.issues,
    },
  };
}

function integerField(value: string | null): number {
  return value && /^\d+$/u.test(value) ? Number(value) : Number.NaN;
}

export async function readRegistrationSettingsForm(
  request: Request,
): Promise<RegistrationSettingsFormSubmission> {
  const form = await readAuthForm(request);
  if ([...form.keys()].some((key) => !SETTINGS_FORM_FIELDS.has(key)))
    throw new InvalidRegistrationSettingsFormError();

  const values = {
    requestKey: form.get("requestKey") ?? "",
    revision: form.get("revision") ?? "",
    minimumPaymentPercent: form.get("minimumPaymentPercent") ?? "",
    auxiliaryDiscountPercent: form.get("auxiliaryDiscountPercent") ?? "",
  };
  return {
    values,
    input: {
      requestKey: values.requestKey,
      revision: integerField(values.revision),
      minimumPaymentPercent: integerField(values.minimumPaymentPercent),
      auxiliaryDiscountPercent: integerField(values.auxiliaryDiscountPercent),
    },
  };
}
