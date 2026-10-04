import type { InternalUser } from "@/domain/auth/types";
import { AuthorizationError } from "@/domain/auth/errors";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import type {
  AdminRegistrationDto,
  CashInput,
  ParticipantDto,
  RegistrationDetailDto,
  RegistrationFilter,
} from "@/domain/pre-registrations/types";
import {
  validateRegistrationId,
  validateRegistrationRevision,
} from "@/domain/pre-registrations/validation";
import { validateParticipant } from "@/domain/pre-registrations/participant";
import { requireRegistrationAdmin } from "@/application/pre-registrations/authorization";
import {
  cancelRegistration,
  createRegistration,
  getRegistrationDetail,
  recordRegistrationPayment,
  recordRegistrationRefund,
  transferRegistration,
  updateParticipant,
  validateRegistrationFilter,
} from "@/application/pre-registrations/manage-registrations";
import type { RegistrationRepository } from "@/application/pre-registrations/registration-repository";
import { RegistrationExportLimitError } from "@/application/pre-registrations/export-registrations";
import { RegistrationPdfTextError } from "@/server/pre-registrations/exports/pdf";
import {
  parseMoneyInput,
  moneyFieldIssues,
} from "@/components/pre-registrations/presentation";
import { InterestError } from "@/domain/interests/rules";
import { readInterestRequest } from "@/server/interests/request";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";

export type RegistrationOperation =
  "create" | "payment" | "refund" | "transfer" | "cancel" | "participant";
export type RegistrationHttpValue =
  | { kind: "created"; registration: AdminRegistrationDto; location: string }
  | { kind: "detail"; detail: RegistrationDetailDto }
  | { kind: "participant"; participant: ParticipantDto };
/** JSON consumers receive domain DTOs, not HTML or database rows. */
export type RegistrationHttpPayload =
  | { ok: true; value: RegistrationHttpValue; message: string }
  | {
      ok: false;
      code: string;
      message: string;
      issues: Readonly<Record<string, string>>;
    };
export const registrationHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export function registrationFailure(error: unknown): {
  status: number;
  payload: Extract<RegistrationHttpPayload, { ok: false }>;
} {
  if (error instanceof RegistrationError) {
    const status =
      error.code === "FORBIDDEN"
        ? 403
        : error.code === "NOT_FOUND"
          ? 404
          : [
                "CONCURRENT_UPDATE",
                "IDEMPOTENCY_CONFLICT",
                "ACTIVE_REGISTRATION_EXISTS",
                "PARTICIPANT_DETAILS_CONFLICT",
                "CAPACITY_EXCEEDED",
              ].includes(error.code)
            ? 409
            : 422;
    return {
      status,
      payload: {
        ok: false,
        code: error.code,
        message: error.message,
        issues: moneyFieldIssues(error.issues),
      },
    };
  }
  if (error instanceof InterestError)
    return {
      status: error.status,
      payload: {
        ok: false,
        code: error.code,
        message: error.message,
        issues: {},
      },
    };
  if (error instanceof AuthorizationError)
    return {
      status: 403,
      payload: {
        ok: false,
        code: "FORBIDDEN",
        message: "No tienes permiso para realizar esta acción.",
        issues: {},
      },
    };
  if (
    error instanceof RegistrationExportLimitError ||
    error instanceof RegistrationPdfTextError
  )
    return {
      status: 422,
      payload: {
        ok: false,
        code: error.code,
        message: error.message,
        issues: {},
      },
    };
  return {
    status: 503,
    payload: {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message:
        "No se pudo confirmar la operación. Conserva los datos y reintenta para comprobar la misma solicitud.",
      issues: {},
    },
  };
}
export function registrationJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...registrationHeaders, "Content-Type": "application/json" },
  });
}
export function wantsRegistrationJson(request: Request): boolean {
  return request.headers.get("accept")?.includes("application/json") ?? false;
}
export function singleQuery(params: URLSearchParams, name: string): string {
  if (params.getAll(name).length > 1)
    throw new RegistrationError("VALIDATION_FAILED", "No repitas los filtros.");
  return params.get(name)?.trim() ?? "";
}
export function parseRegistrationFilter(
  params: URLSearchParams,
): RegistrationFilter {
  const integer = (name: string, fallback: number) => {
    const value = singleQuery(params, name);
    if (!value) return fallback;
    if (!/^\d+$/u.test(value))
      throw new RegistrationError(
        "VALIDATION_FAILED",
        "Los filtros no son válidos.",
      );
    return Number(value);
  };
  const courseId = singleQuery(params, "courseId");
  const groupId = singleQuery(params, "groupId");
  const membershipStatus = singleQuery(params, "membershipStatus");
  const financialStatus = singleQuery(params, "financialStatus");
  const search = singleQuery(params, "search");
  if (/\p{Cc}/u.test(search))
    throw new RegistrationError("VALIDATION_FAILED", "Busca con texto válido.");
  return validateRegistrationFilter({
    page: integer("page", 1),
    pageSize: integer("pageSize", 20),
    ...(courseId ? { courseId } : {}),
    ...(groupId ? { groupId } : {}),
    ...(search ? { search } : {}),
    ...(membershipStatus
      ? {
          membershipStatus:
            membershipStatus as RegistrationFilter["membershipStatus"] & string,
        }
      : {}),
    ...(financialStatus
      ? {
          financialStatus:
            financialStatus as RegistrationFilter["financialStatus"] & string,
        }
      : {}),
  });
}
export function flatRegistrationValues(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "El formulario no es válido.",
    );
  const values: Record<string, string> = {};
  const fields = new Set([
    "requestKey",
    "courseId",
    "groupId",
    "courseRevision",
    "settingsRevision",
    "sourceInterestId",
    "ci",
    "firstName",
    "lastName",
    "email",
    "phone",
    "participantType",
    "firstDayException",
    "amount",
    "amountCents",
    "effectiveDate",
    "reason",
    "registrationId",
    "revision",
    "participantId",
    "destinationGroupId",
    "confirmed",
  ]);
  for (const [key, value] of Object.entries(raw)) {
    if (!fields.has(key))
      throw new RegistrationError(
        "VALIDATION_FAILED",
        "El formulario contiene campos no admitidos.",
      );
    if (typeof value !== "string")
      throw new RegistrationError(
        "VALIDATION_FAILED",
        "Envía los campos del formulario como texto.",
      );
    values[key] = value;
  }
  return values;
}
/** `amount` is decimal BOB at the HTTP boundary. Only this conversion creates cents. */
export function cashFromRegistrationValues(
  values: Readonly<Record<string, string>>,
): CashInput {
  return {
    amountCents: parseMoneyInput(values.amount ?? ""),
    effectiveDate: values.effectiveDate || null,
    reason: values.reason ?? "",
  };
}
export async function handleRegistrationPost(input: {
  request: Request;
  actor: InternalUser;
  repository: RegistrationRepository;
  siteUrl: URL;
  operation: RegistrationOperation;
  registrationId?: string;
  participantId?: string;
  now?: Date;
}): Promise<{
  status: number;
  payload: RegistrationHttpPayload;
  values: Record<string, string>;
}> {
  let values: Record<string, string> = {};
  try {
    requireRegistrationAdmin(input.actor);
    if (
      ![
        "create",
        "payment",
        "refund",
        "transfer",
        "cancel",
        "participant",
      ].includes(input.operation)
    )
      throw new RegistrationError(
        "VALIDATION_FAILED",
        "La operación no es válida.",
      );
    if (!requestHasExpectedOrigin(input.request, input.siteUrl))
      return {
        status: 403,
        payload: {
          ok: false,
          code: "INVALID_ORIGIN",
          message:
            "No se pudo validar el origen. Recarga el formulario y reintenta.",
          issues: {},
        },
        values,
      };
    values = flatRegistrationValues(
      await readInterestRequest(input.request, 16_384),
    );
    if (Object.hasOwn(values, "amountCents"))
      throw new RegistrationError(
        "VALIDATION_FAILED",
        "Envía el importe decimal en el campo amount; no envíes centavos desde el formulario.",
        { amount: "Introduce el importe en bolivianos." },
      );
    const now = input.now ?? new Date();
    const requestKey = validateRegistrationId(values.requestKey, "requestKey");
    if (input.operation === "create") {
      if (!/^\d+$/u.test(values.settingsRevision ?? ""))
        throw new RegistrationError(
          "VALIDATION_FAILED",
          "Recarga la configuración vigente.",
        );
      if (
        values.firstDayException !== undefined &&
        values.firstDayException !== "true"
      )
        throw new RegistrationError(
          "VALIDATION_FAILED",
          "La excepción no es válida.",
        );
      const registration = await createRegistration(
        input.repository,
        input.actor,
        {
          requestKey,
          courseId: values.courseId,
          groupId: values.groupId,
          courseRevision: values.courseRevision,
          settingsRevision: Number(values.settingsRevision),
          sourceInterestId: values.sourceInterestId || null,
          participant: validateParticipant(values),
          participantType: values.participantType,
          firstDayException: values.firstDayException === "true",
          initialPayment: values.amount?.trim()
            ? cashFromRegistrationValues(values)
            : null,
        },
        now,
      );
      return {
        status: 200,
        values,
        payload: {
          ok: true,
          message: "Preinscripción registrada.",
          value: {
            kind: "created",
            registration,
            location: `/app/preinscripciones/${registration.id}`,
          },
        },
      };
    }
    const revision = validateRegistrationRevision(values.revision);
    if (input.operation === "participant") {
      const participantId = validateRegistrationId(
        input.participantId,
        "participantId",
      );
      if (values.participantId !== participantId)
        throw new RegistrationError(
          "VALIDATION_FAILED",
          "La ficha no corresponde a esta ruta.",
        );
      const participant = await updateParticipant(
        input.repository,
        input.actor,
        {
          requestKey,
          revision,
          participantId,
          participant: validateParticipant(values),
        },
      );
      return {
        status: 200,
        values,
        payload: {
          ok: true,
          message: "Ficha global actualizada.",
          value: { kind: "participant", participant },
        },
      };
    }
    const registrationId = validateRegistrationId(
      input.registrationId,
      "registrationId",
    );
    if (values.registrationId !== registrationId)
      throw new RegistrationError(
        "VALIDATION_FAILED",
        "La preinscripción no corresponde a esta ruta.",
      );
    const mutation = { requestKey, revision, registrationId };
    if (input.operation === "transfer") {
      const registration = await transferRegistration(
        input.repository,
        input.actor,
        { ...mutation, destinationGroupId: values.destinationGroupId ?? "" },
      );
      const detail = await getRegistrationDetail(
        input.repository,
        input.actor,
        registration.id,
      );
      if (!detail)
        throw new RegistrationError("NOT_FOUND", "Registro no encontrado.");
      return {
        status: 200,
        values,
        payload: {
          ok: true,
          message: "Grupo actualizado. La tarifa se conserva.",
          value: { kind: "detail", detail },
        },
      };
    }
    const detail =
      input.operation === "cancel"
        ? await cancelRegistration(
            input.repository,
            input.actor,
            { ...mutation, reason: values.reason ?? "", refundedNow: null },
            now,
          )
        : input.operation === "payment"
          ? await recordRegistrationPayment(
              input.repository,
              input.actor,
              { ...mutation, cash: cashFromRegistrationValues(values) },
              now,
            )
          : await recordRegistrationRefund(
              input.repository,
              input.actor,
              { ...mutation, cash: cashFromRegistrationValues(values) },
              now,
            );
    return {
      status: 200,
      values,
      payload: {
        ok: true,
        message:
          input.operation === "cancel"
            ? "Preinscripción cancelada. Revisa la devolución pendiente."
            : input.operation === "payment"
              ? "Abono registrado."
              : "Devolución registrada.",
        value: { kind: "detail", detail },
      },
    };
  } catch (error) {
    return { ...registrationFailure(error), values };
  }
}
