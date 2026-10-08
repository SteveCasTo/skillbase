import type { APIContext } from "astro";
import type {
  AdminAccountRepository,
  AdminCredentialGateway,
} from "@/application/admin-accounts/repository";
import { requireRoles } from "@/application/auth/authorize";
import {
  AdminAccountError,
  adminAccountId,
} from "@/domain/admin-accounts/rules";
import type { AdminAccountDto } from "@/domain/admin-accounts/types";
import { requireInternalUser } from "@/server/auth/context";
import { getPublicAuthEnvironment } from "@/server/environment";
import { readInterestRequest } from "@/server/interests/request";
import { getAdminCredentialGateway } from "./credentials";
import {
  adminAccountFailure,
  adminAccountHeaders,
  adminAccountJson,
  handleAdminAccountPost,
  type AdminAccountOperation,
} from "./http";
import { loadAdminAccount } from "./loaders";
import { getAdminAccountRepository } from "./service";

type PageContext = Pick<
  APIContext,
  "request" | "locals" | "url" | "redirect"
> & {
  response: { status?: number; headers: Headers };
};
interface Dependencies {
  repository: AdminAccountRepository;
  gateway: () => AdminCredentialGateway;
  siteUrl: URL;
}
const detailOperations: readonly AdminAccountOperation[] = [
  "name",
  "delete",
  "retry-delete",
  "deactivate",
  "activate",
];

/** Adapts the existing command contract to SSR; actor and target never come from the body. */
export async function adminAccountPage(
  context: PageContext,
  id?: string,
  dependencies?: Dependencies,
) {
  const actor = requireInternalUser(context.locals);
  requireRoles(actor, ["ADMIN"]);
  for (const [key, value] of Object.entries(adminAccountHeaders))
    context.response.headers.set(key, value);
  const deps = dependencies ?? {
    repository: getAdminAccountRepository(),
    gateway: getAdminCredentialGateway,
    siteUrl: getPublicAuthEnvironment().siteUrl,
  };
  let account: AdminAccountDto | null = null;
  let values: Record<string, string> = {};
  let issues: Readonly<Record<string, string>> = {};
  let error: string | null = null;
  let code: string | null = null;
  let response: Response | null = null;
  let submittedName = false;
  const json = context.request.headers
    .get("accept")
    ?.includes("application/json");
  try {
    if (id !== undefined) {
      try {
        adminAccountId(id);
      } catch {
        throw new AdminAccountError("NOT_FOUND", "Cuenta no disponible.");
      }
      account = await loadAdminAccount(actor, id, deps.repository);
      if (!account)
        throw new AdminAccountError("NOT_FOUND", "Cuenta no disponible.");
      values = { name: account.name };
    } else await deps.repository.authorize(actor.id);
    if (context.request.method === "POST") {
      const operation =
        id === undefined ? "create" : context.url.searchParams.get("operation");
      if (
        !operation ||
        (id !== undefined &&
          !detailOperations.includes(operation as AdminAccountOperation))
      )
        throw new AdminAccountError(
          "VALIDATION_FAILED",
          "La acción no está disponible.",
        );
      // Keep only non-secret attempted fields for HTML recovery. Never serialize the password.
      const recoveryRequest = context.request.clone();
      const result = await handleAdminAccountPost({
        request: context.request,
        siteUrl: deps.siteUrl,
        actor,
        repository: deps.repository,
        gateway: {
          createConfirmedUser: (email, password) =>
            deps.gateway().createConfirmedUser(email, password),
          removeCreatedUser: (authUserId) =>
            deps.gateway().removeCreatedUser(authUserId),
          deleteUser: (authUserId) => deps.gateway().deleteUser(authUserId),
        },
        operation: operation as AdminAccountOperation,
        ...(id !== undefined ? { id } : {}),
      });
      if (result.payload.ok) {
        if (!result.payload.value.actorActive)
          response = context.redirect("/login", 303);
        else if (json)
          response = adminAccountJson(result.payload, result.status);
        else {
          const destination = result.payload.value.deleted
            ? "/app/administradores?success=deleted"
            : `/app/administradores/${result.payload.value.account!.id}?success=saved`;
          response = context.redirect(destination, 303);
        }
      } else {
        // A failed self-delete may already have blocked the actor durably.
        await deps.repository.authorize(actor.id);
        error = result.payload.message;
        code = result.payload.code;
        issues = result.payload.issues;
        context.response.status = result.status;
        if (json) response = adminAccountJson(result.payload, result.status);
        else {
          try {
            const raw: unknown = await readInterestRequest(
              recoveryRequest,
              8192,
            );
            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
              const fields = raw as Record<string, unknown>;
              for (const key of id === undefined ? ["name", "email"] : ["name"])
                if (typeof fields[key] === "string") values[key] = fields[key];
            }
          } catch {
            /* Malformed requests have no recoverable fields. */
          }
          submittedName = operation === "name";
          if (id !== undefined)
            account = await loadAdminAccount(actor, id, deps.repository);
        }
      }
    }
  } catch (cause) {
    const failure = adminAccountFailure(cause);
    context.response.status = failure.status;
    error = failure.payload.message;
    code = failure.payload.code;
    issues = failure.payload.issues;
    if (failure.status === 403) response = context.redirect("/login", 303);
    else if (json && context.request.method === "POST")
      response = adminAccountJson(failure.payload, failure.status);
  }
  if (response)
    for (const [key, value] of Object.entries(adminAccountHeaders))
      response.headers.set(key, value);
  return {
    account,
    values,
    issues,
    error,
    code,
    response,
    submittedName,
    actorId: actor.id,
  };
}
