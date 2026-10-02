import { requireRoles, resolveActiveUser } from "./authorize";
import type { AuthUserRepository } from "./user-repository";
import { requirePassword } from "@/domain/auth/identity";
import { normalizeEmail } from "@/domain/auth/policies";
import type { InternalUser } from "@/domain/auth/types";
import {
  validateInstructor,
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
  requirePassword(input.password);
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
  } catch {
    throw new Error(
      "No pudimos crear la cuenta. Revisa los datos e inténtalo nuevamente.",
    );
  }
  if (!authUserId)
    throw new Error(
      "No pudimos crear la cuenta. Revisa los datos e inténtalo nuevamente.",
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
  } catch {
    await gateway.removeCreatedUser(authUserId).catch(() => {});
    throw new Error(
      "No pudimos crear la cuenta. Revisa los datos e inténtalo nuevamente.",
    );
  }
}
