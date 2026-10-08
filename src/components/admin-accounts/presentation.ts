import type {
  AdminAccountAction,
  AdminAccountDto,
} from "@/domain/admin-accounts/types";

export function adminAccountStatus(
  account: Pick<AdminAccountDto, "status" | "deletionPending">,
): string {
  if (account.deletionPending)
    return "Eliminación pendiente · acceso bloqueado";
  return account.status === "ACTIVE"
    ? "Cuenta activa"
    : account.status === "DISABLED"
      ? "Cuenta desactivada"
      : "Acceso no habilitado";
}

export const adminAccountActions: Record<
  AdminAccountAction,
  { label: string; copy: string; destructive: boolean }
> = {
  delete: {
    label: "Eliminar administrador",
    copy: "Se eliminará el acceso a esta cuenta. Esta acción no se puede deshacer.",
    destructive: true,
  },
  "retry-delete": {
    label: "Completar eliminación",
    copy: "La cuenta sigue bloqueada. Se reintentará eliminar su acceso.",
    destructive: true,
  },
  deactivate: {
    label: "Desactivar administrador",
    copy: "Se bloqueará el acceso a esta cuenta. Su historial se conserva.",
    destructive: false,
  },
  activate: {
    label: "Reactivar administrador",
    copy: "Se habilitará nuevamente el acceso a esta cuenta.",
    destructive: false,
  },
};

export function adminAccountBlockedReason(
  account: Pick<AdminAccountDto, "lifecycleBlockedReason">,
): string | null {
  return account.lifecycleBlockedReason === "last-active-admin"
    ? "Debe quedar al menos un administrador activo."
    : null;
}

export function adminCreateEligible(
  values: Readonly<Record<string, string>>,
): boolean {
  const name = values.name?.trim() ?? "";
  const email = values.email?.trim() ?? "";
  const password = values.password ?? "";
  return Boolean(
    name &&
    name.length <= 250 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) &&
    password.length >= 12 &&
    password.length <= 128,
  );
}
