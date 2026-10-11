import { requireRoles, resolveActiveUser } from "./authorize";
import type { AuthUserRepository } from "./user-repository";
import { requirePassword } from "@/domain/auth/identity";
import { AccountProvisionError } from "@/domain/auth/account-provision-error";
import { normalizeEmail } from "@/domain/auth/policies";
import type { InternalUser } from "@/domain/auth/types";
import {
  validateInstructor,
  InstructorError,
  instructorFullName,
  type InstructorProfileData,
} from "@/domain/instructors/profile";

export interface PasswordProvisionInput {
  email: string;
  name: string;
  password: string;
  profile?: InstructorProfileData;
}
export interface PasswordProvisionRepository extends AuthUserRepository {
  createPasswordInstructor(input: {
    email: string;
    name: string;
    authUserId: string;
    profile?: InstructorProfileData;
    actorId?: string;
  }): Promise<InternalUser>;
}
export interface PasswordProvisionGateway {
  createConfirmedUser(email: string, password: string): Promise<string | null>;
  removeCreatedUser(authUserId: string): Promise<void>;
}

/** Server callers supply the authenticated actor UUID, never roles/actor from a form. */
export async function provisionPasswordInstructor(
  repository: PasswordProvisionRepository,
  gateway: PasswordProvisionGateway,
  actorAuthUserId: string,
  input: PasswordProvisionInput,
): Promise<InternalUser> {
  const actor = await resolveActiveUser(repository, actorAuthUserId);
  requireRoles(actor, ["ADMIN"]);
  try {
    requirePassword(input.password);
  } catch {
    throw new InstructorError("Revisa la contraseña inicial.", {
      password: "La contraseña debe tener entre 12 y 128 caracteres.",
    });
  }
  const email = normalizeEmail(input.email);
  const profile = input.profile
    ? validateInstructor({
        ...input.profile,
        phone: input.profile.phone ?? "",
        email,
      })
    : undefined;
  const name = profile ? instructorFullName(profile) : input.name.trim();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
    !name ||
    name.length > 251
  )
    throw new Error("Los datos de la cuenta no son válidos.");
  let authUserId: string | null;
  try {
    authUserId = await gateway.createConfirmedUser(email, input.password);
  } catch (cause) {
    throw new AccountProvisionError(
      "No pudimos crear la cuenta. Inténtalo nuevamente más tarde.",
      { cause },
    );
  }
  if (!authUserId)
    throw new AccountProvisionError(
      "No pudimos crear la cuenta. Inténtalo nuevamente más tarde.",
    );
  try {
    // Check again after the provider operation: a disabled actor cannot finish provisioning.
    requireRoles(await resolveActiveUser(repository, actorAuthUserId), [
      "ADMIN",
    ]);
    return await repository.createPasswordInstructor({
      email,
      name,
      authUserId,
      ...(profile ? { profile } : {}),
      actorId: actor.id,
    });
  } catch (cause) {
    await gateway.removeCreatedUser(authUserId).catch(() => {});
    throw new AccountProvisionError(
      "No pudimos crear la cuenta. Recarga antes de reintentar.",
      { cause },
    );
  }
}
