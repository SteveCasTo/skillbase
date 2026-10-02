import { canAccessPrivateApp } from "@/domain/auth/policies";
import type { InternalUser } from "@/domain/auth/types";
import { AuthorizationError } from "@/domain/auth/errors";

export interface PasswordGateway {
  verifyCurrentPassword(
    email: string,
    password: string,
    authUserId: string,
  ): Promise<boolean>;
  updatePassword(password: string): Promise<boolean>;
  recordPasswordChanged(actorId: string): Promise<void>;
}

export class PasswordChangeError extends Error {
  constructor(
    message: string,
    readonly field?: "currentPassword" | "password" | "confirmation",
  ) {
    super(message);
  }
}

export async function changeAccountPassword(
  user: InternalUser,
  input: {
    password: string;
    confirmation: string;
    currentPassword: string;
    hasRecoveryProof: boolean;
    hasGoogleProof?: boolean;
  },
  gateway: PasswordGateway,
): Promise<void> {
  if (!canAccessPrivateApp(user) || !user.authUserId)
    throw new AuthorizationError("FORBIDDEN", "Account is not active");
  if (input.password.length < 12 || input.password.length > 128)
    throw new PasswordChangeError(
      "Usa entre 12 y 128 caracteres para la nueva contraseña.",
      "password",
    );
  if (input.password !== input.confirmation)
    throw new PasswordChangeError(
      "Las contraseñas no coinciden. Repite la nueva contraseña.",
      "confirmation",
    );
  if (
    !input.hasRecoveryProof &&
    !input.hasGoogleProof &&
    (!input.currentPassword ||
      input.currentPassword.length > 128 ||
      !(await gateway.verifyCurrentPassword(
        user.email,
        input.currentPassword,
        user.authUserId,
      )))
  )
    throw new PasswordChangeError(
      "La contraseña actual es incorrecta. Inténtalo nuevamente.",
      "currentPassword",
    );
  if (input.currentPassword && input.password === input.currentPassword)
    throw new PasswordChangeError(
      "La nueva contraseña debe ser diferente de la actual.",
      "password",
    );
  if (!(await gateway.updatePassword(input.password)))
    throw new Error(
      "No pudimos cambiar la contraseña. Confirma tu acceso e inténtalo nuevamente.",
    );
  try {
    await gateway.recordPasswordChanged(user.id);
  } catch {
    // Supabase Auth and PostgreSQL cannot share a transaction. Do not report a
    // failed password change after the provider has already accepted it.
    console.error({
      event: "PASSWORD_CHANGE_AUDIT_WRITE_FAILED",
      actorId: user.id,
    });
  }
}
