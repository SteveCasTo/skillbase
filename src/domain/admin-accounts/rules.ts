import type { AdminAccountAction, AdminAccountDto } from "./types";
export type AdminAccountErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONCURRENT_UPDATE"
  | "LAST_ACTIVE_ADMIN"
  | "ACCOUNT_USED"
  | "ROLE_NOT_EXCLUSIVE"
  | "INVALID_STATE"
  | "EMAIL_EXISTS"
  | "AUTH_UNAVAILABLE"
  | "DELETION_PENDING";
export class AdminAccountError extends Error {
  constructor(
    readonly code: AdminAccountErrorCode,
    message: string,
    readonly issues: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "AdminAccountError";
  }
}
export function validateAdminName(value: string): string {
  const name = value.trim();
  // eslint-disable-next-line no-control-regex
  if (!name || name.length > 250 || /[\u0000-\u001f\u007f]/u.test(name))
    throw new AdminAccountError(
      "VALIDATION_FAILED",
      "Indica un nombre válido de hasta 250 caracteres.",
      { name: "Indica un nombre válido de hasta 250 caracteres." },
    );
  return name;
}
export function adminAccountId(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    throw new AdminAccountError(
      "VALIDATION_FAILED",
      "Identificador no válido.",
    );
  return value;
}
export function adminRevision(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new AdminAccountError(
      "VALIDATION_FAILED",
      "Recarga la revisión vigente.",
      { revision: "Revisión no válida." },
    );
  return date;
}
export function applicableAdminAction(
  state: Pick<
    AdminAccountDto,
    "status" | "exclusiveAdmin" | "hasActivity" | "deletionPending"
  >,
): AdminAccountAction | null {
  if (!state.exclusiveAdmin || state.status === "INVITED") return null;
  if (state.deletionPending) return "retry-delete";
  if (!state.hasActivity) return "delete";
  return state.status === "ACTIVE" ? "deactivate" : "activate";
}
export function assertAdminAction(
  state: AdminAccountDto,
  action: AdminAccountAction,
): void {
  if (!state.exclusiveAdmin)
    throw new AdminAccountError(
      "ROLE_NOT_EXCLUSIVE",
      "La cuenta multirol debe conservar su perfil y permisos profesionales.",
    );
  if (applicableAdminAction(state) !== action)
    throw new AdminAccountError(
      state.hasActivity && action === "delete"
        ? "ACCOUNT_USED"
        : "INVALID_STATE",
      "La acción ya no está disponible. Recarga la cuenta.",
    );
}
