import {
  provisionPasswordInstructor,
  type PasswordProvisionInput,
} from "@/application/auth/provision-password-user";
import {
  createConfirmedAccount,
  getAccountCredentialClient,
  removeCreatedAccount,
} from "./account-credentials";
import { getDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { AccountProvisionError } from "@/domain/auth/account-provision-error";

/** No public endpoint. Call only after getUser() in the instructor application flow. */
export async function createInstructorAccount(
  actorAuthUserId: string,
  input: PasswordProvisionInput,
) {
  let privileged;
  try {
    privileged = getAccountCredentialClient();
  } catch (cause) {
    throw new AccountProvisionError(
      "La creación de cuentas no está disponible. Inténtalo nuevamente más tarde.",
      { cause },
    );
  }
  return provisionPasswordInstructor(
    new DrizzleAuthUserRepository(getDatabase()),
    {
      createConfirmedUser: (email, password) =>
        createConfirmedAccount(privileged, email, password),
      removeCreatedUser: (id) => removeCreatedAccount(privileged, id),
    },
    actorAuthUserId,
    input,
  );
}
