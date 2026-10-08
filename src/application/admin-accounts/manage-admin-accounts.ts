import { requireRoles } from "@/application/auth/authorize";
import { requirePassword } from "@/domain/auth/identity";
import { normalizeEmail } from "@/domain/auth/policies";
import type { InternalUser } from "@/domain/auth/types";
import {
  AdminAccountError,
  adminAccountId,
  adminRevision,
  validateAdminName,
} from "@/domain/admin-accounts/rules";
import type {
  AdminAccountAction,
  AdminAccountResult,
  CreateAdminAccountInput,
} from "@/domain/admin-accounts/types";
import type {
  AdminAccountRepository,
  AdminCredentialGateway,
} from "./repository";

export async function createAdminAccount(
  repository: AdminAccountRepository,
  gateway: AdminCredentialGateway,
  actor: InternalUser,
  input: CreateAdminAccountInput,
): Promise<AdminAccountResult> {
  requireRoles(actor, ["ADMIN"]);
  await repository.authorize(actor.id);
  const name = validateAdminName(input.name);
  const email = normalizeEmail(input.email);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
    throw new AdminAccountError(
      "VALIDATION_FAILED",
      "Indica un correo válido.",
      { email: "Indica un correo válido." },
    );
  try {
    requirePassword(input.password);
  } catch {
    throw new AdminAccountError(
      "VALIDATION_FAILED",
      "La contraseña debe tener entre 12 y 128 caracteres.",
      { password: "La contraseña debe tener entre 12 y 128 caracteres." },
    );
  }
  if (await repository.emailExists(actor.id, email))
    throw new AdminAccountError(
      "EMAIL_EXISTS",
      "Ya existe una cuenta con ese correo.",
      { email: "El correo ya está registrado." },
    );
  let authUserId: string | null;
  try {
    authUserId = await gateway.createConfirmedUser(email, input.password);
  } catch {
    authUserId = null;
  }
  if (!authUserId)
    throw new AdminAccountError(
      "AUTH_UNAVAILABLE",
      "No pudimos crear la cuenta. Revisa el correo e inténtalo nuevamente.",
    );
  try {
    await repository.authorize(actor.id);
    const account = await repository.create(actor.id, {
      name,
      email,
      authUserId,
    });
    return { account, actorActive: true, deleted: false };
  } catch (error) {
    // Only this freshly-created UUID is eligible for compensation. Never attach/delete an existing identity.
    await gateway.removeCreatedUser(authUserId).catch(() => {});
    if (error instanceof AdminAccountError) throw error;
    throw new AdminAccountError(
      "AUTH_UNAVAILABLE",
      "No pudimos confirmar la cuenta. Recarga antes de reintentar.",
    );
  }
}
export async function renameAdminAccount(
  repository: AdminAccountRepository,
  actor: InternalUser,
  id: string,
  name: string,
  revision: string,
) {
  requireRoles(actor, ["ADMIN"]);
  return repository.rename(
    actor.id,
    adminAccountId(id),
    validateAdminName(name),
    adminRevision(revision),
  );
}
export async function mutateAdminAccount(
  repository: AdminAccountRepository,
  gateway: AdminCredentialGateway,
  actor: InternalUser,
  id: string,
  action: AdminAccountAction,
  revision: string,
): Promise<AdminAccountResult> {
  requireRoles(actor, ["ADMIN"]);
  adminAccountId(id);
  const expected = adminRevision(revision);
  if (action === "activate" || action === "deactivate")
    return repository.setActive(actor.id, id, action, expected);
  const intent = await repository.beginDeletion(actor.id, id, action, expected);
  if (intent.completed)
    return { account: null, actorActive: intent.actorActive, deleted: true };
  try {
    // Self-deletion intentionally disabled this actor; the durable intent authorizes completion only.
    if (actor.id !== id) await repository.authorize(actor.id);
    await gateway.deleteUser(intent.authUserId);
    return await repository.completeDeletion(actor.id, id, intent.authUserId);
  } catch {
    throw new AdminAccountError(
      "DELETION_PENDING",
      "La cuenta sigue bloqueada. Recarga y reintenta la eliminación pendiente.",
    );
  }
}
