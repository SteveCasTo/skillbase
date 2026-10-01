import { requirePassword } from "@/domain/auth/identity";
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
}

export async function changeAccountPassword(
  user: InternalUser,
  input: {
    password: string;
    confirmation: string;
    currentPassword: string;
    hasRecoveryProof: boolean;
  },
  gateway: PasswordGateway,
): Promise<void> {
  if (!canAccessPrivateApp(user) || !user.authUserId)
    throw new AuthorizationError("FORBIDDEN", "Account is not active");
  requirePassword(input.password, input.confirmation);
  if (
    !input.hasRecoveryProof &&
    (!input.currentPassword ||
      input.currentPassword.length > 128 ||
      !(await gateway.verifyCurrentPassword(
        user.email,
        input.currentPassword,
        user.authUserId,
      )))
  )
    throw new Error(
      "Confirma tu contraseña actual o utiliza el enlace enviado a tu correo.",
    );
  if (!(await gateway.updatePassword(input.password)))
    throw new Error(
      "No pudimos cambiar la contraseña. Confirma tu acceso e inténtalo nuevamente.",
    );
}
