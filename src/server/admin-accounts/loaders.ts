import { requireRoles } from "@/application/auth/authorize";
import type { InternalUser } from "@/domain/auth/types";
import { adminAccountId } from "@/domain/admin-accounts/rules";
import type { AdminAccountRepository } from "@/application/admin-accounts/repository";
import { getAdminAccountRepository } from "./service";
export function loadAdminAccounts(
  actor: InternalUser,
  repository: AdminAccountRepository = getAdminAccountRepository(),
) {
  requireRoles(actor, ["ADMIN"]);
  return repository.list(actor.id);
}
export function loadAdminAccount(
  actor: InternalUser,
  id: string,
  repository: AdminAccountRepository = getAdminAccountRepository(),
) {
  requireRoles(actor, ["ADMIN"]);
  return repository.get(actor.id, adminAccountId(id));
}
