import type { InternalUser } from "@/domain/auth/types";
import { AuthorizationError } from "@/domain/auth/errors";
import { AdminAccountError } from "@/domain/admin-accounts/rules";
import type {
  AdminAccountAction,
  AdminAccountResult,
} from "@/domain/admin-accounts/types";
import type {
  AdminAccountRepository,
  AdminCredentialGateway,
} from "@/application/admin-accounts/repository";
import {
  createAdminAccount,
  mutateAdminAccount,
  renameAdminAccount,
} from "@/application/admin-accounts/manage-admin-accounts";
import { requireRoles } from "@/application/auth/authorize";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { readInterestRequest } from "@/server/interests/request";
import { InterestError } from "@/domain/interests/rules";
export type AdminAccountOperation = "create" | "name" | AdminAccountAction;
export type AdminAccountHttpPayload =
  | { ok: true; value: AdminAccountResult; message: string }
  | {
      ok: false;
      code: string;
      message: string;
      issues: Readonly<Record<string, string>>;
    };
export const adminAccountHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function adminAccountJson(
  payload: AdminAccountHttpPayload,
  status = 200,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...adminAccountHeaders, "Content-Type": "application/json" },
  });
}
export function adminAccountFailure(error: unknown): {
  status: number;
  payload: Extract<AdminAccountHttpPayload, { ok: false }>;
} {
  if (error instanceof AdminAccountError)
    return {
      status:
        error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND"
            ? 404
            : ["AUTH_UNAVAILABLE", "DELETION_PENDING"].includes(error.code)
              ? 503
              : [
                    "CONCURRENT_UPDATE",
                    "LAST_ACTIVE_ADMIN",
                    "ACCOUNT_USED",
                    "ROLE_NOT_EXCLUSIVE",
                    "INVALID_STATE",
                    "EMAIL_EXISTS",
                  ].includes(error.code)
                ? 409
                : 422,
      payload: {
        ok: false,
        code: error.code,
        message: error.message,
        issues: error.issues,
      },
    };
  if (error instanceof AuthorizationError)
    return {
      status: 403,
      payload: {
        ok: false,
        code: "FORBIDDEN",
        message: "La cuenta no tiene autorización vigente.",
        issues: {},
      },
    };
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
  return {
    status: 503,
    payload: {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message:
        "No pudimos confirmar la operación. Recarga antes de reintentar.",
      issues: {},
    },
  };
}
/** Future routes supply operation/target and the server-authenticated actor; no route mounted here. */
export async function handleAdminAccountPost(input: {
  request: Request;
  siteUrl: URL;
  actor: InternalUser;
  repository: AdminAccountRepository;
  gateway: AdminCredentialGateway;
  operation: AdminAccountOperation;
  id?: string;
}): Promise<{ status: number; payload: AdminAccountHttpPayload }> {
  try {
    requireRoles(input.actor, ["ADMIN"]);
    await input.repository.authorize(input.actor.id);
    if (!requestHasExpectedOrigin(input.request, input.siteUrl))
      return {
        status: 403,
        payload: {
          ok: false,
          code: "INVALID_ORIGIN",
          message: "Recarga y reintenta desde el formulario.",
          issues: {},
        },
      };
    const raw: unknown = await readInterestRequest(input.request, 8192);
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new AdminAccountError(
        "VALIDATION_FAILED",
        "La solicitud no es válida.",
      );
    const data = raw as Record<string, unknown>;
    const fields =
      input.operation === "create"
        ? ["name", "email", "password"]
        : input.operation === "name"
          ? ["name", "revision"]
          : ["revision"];
    if (
      Object.keys(data).some((k) => !fields.includes(k)) ||
      fields.some((k) => typeof data[k] !== "string")
    )
      throw new AdminAccountError(
        "VALIDATION_FAILED",
        "La solicitud contiene campos no admitidos o incompletos.",
      );
    const text = (key: string) => data[key] as string;
    const value =
      input.operation === "create"
        ? await createAdminAccount(
            input.repository,
            input.gateway,
            input.actor,
            {
              name: text("name"),
              email: text("email"),
              password: text("password"),
            },
          )
        : input.operation === "name"
          ? await renameAdminAccount(
              input.repository,
              input.actor,
              input.id ?? "",
              text("name"),
              text("revision"),
            )
          : await mutateAdminAccount(
              input.repository,
              input.gateway,
              input.actor,
              input.id ?? "",
              input.operation,
              text("revision"),
            );
    return {
      status: 200,
      payload: {
        ok: true,
        value,
        message: value.deleted
          ? "Cuenta eliminada."
          : input.operation === "create"
            ? "Cuenta de administrador creada."
            : "Cuenta actualizada.",
      },
    };
  } catch (error) {
    return adminAccountFailure(error);
  }
}
