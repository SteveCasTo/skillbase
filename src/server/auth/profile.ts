import type { APIContext } from "astro";
import { changeAccountPassword } from "@/application/auth/change-password";
import { isGoogleAssociated } from "@/domain/auth/identity";
import { accountIdentity } from "./identity";
import {
  loadRequestAuthContext,
  requireRequestSupabaseClient,
} from "./context";
import { requestHasExpectedOrigin } from "./redirects";
import {
  consumeAuthAttempt,
  readAuthForm,
  readAuthProof,
  sessionProofValue,
} from "./security";
import { getPublicAuthEnvironment } from "@/server/environment";
import { getDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";

type ProfileContext = Pick<
  APIContext,
  "request" | "locals" | "cookies" | "clientAddress"
> & { response: { status?: number } };

export async function updateProfilePassword(
  context: ProfileContext,
): Promise<{ error: string | null }> {
  const environment = getPublicAuthEnvironment();
  if (!requestHasExpectedOrigin(context.request, environment.siteUrl)) {
    context.response.status = 403;
    return { error: "La solicitud no es válida. Vuelve a abrir tu perfil." };
  }
  const supabase = requireRequestSupabaseClient(context.locals);
  const repository = new DrizzleAuthUserRepository(getDatabase());
  try {
    const auth = await loadRequestAuthContext(supabase, repository);
    if (!auth.internalUser || !auth.authUser)
      throw new Error("Confirma tu sesión e inténtalo nuevamente.");
    if (
      !(await consumeAuthAttempt(
        context.clientAddress,
        "password",
        auth.internalUser.email,
      ))
    )
      throw new Error("Demasiados intentos. Inténtalo más tarde.");
    const form = await readAuthForm(context.request);
    const { data: session } = await supabase.auth.getSession();
    const proof = readAuthProof(
      context.cookies.get("auth-password-proof")?.value,
    );
    const hasRecoveryProof = Boolean(
      session.session &&
      proof ===
        sessionProofValue(auth.authUser.id, session.session.access_token),
    );
    await changeAccountPassword(
      auth.internalUser,
      {
        password: form.get("password") ?? "",
        confirmation: form.get("confirmation") ?? "",
        currentPassword: form.get("currentPassword") ?? "",
        hasRecoveryProof,
      },
      {
        async verifyCurrentPassword(email, password, authUserId) {
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (error) return false;
          if (data.user?.id !== authUserId) {
            await supabase.auth.signOut({ scope: "local" });
            return false;
          }
          const { data: verified, error: invalid } =
            await supabase.auth.getUser();
          if (invalid || !verified.user) return false;
          const verifiedContext = await loadRequestAuthContext(
            supabase,
            repository,
          );
          if (
            !verifiedContext.internalUser ||
            verifiedContext.session?.method !== "PASSWORD"
          )
            return false;
          return true;
        },
        async updatePassword(password) {
          const latest = await loadRequestAuthContext(supabase, repository);
          if (
            !latest.internalUser ||
            latest.internalUser.id !== auth.internalUser!.id
          )
            return false;
          const google = accountIdentity(auth.authUser!).identities.find(
            (entry) => entry.provider === "google",
          );
          if (
            google &&
            isGoogleAssociated(
              auth.internalUser!,
              accountIdentity(auth.authUser!),
            )
          )
            await repository.approveGoogleIdentity(
              auth.authUser!.id,
              google.id,
            );
          const { error } = await supabase.auth.updateUser({ password });
          return !error;
        },
      },
    );
    context.cookies.delete("auth-password-proof", { path: "/" });
    return { error: null };
  } catch (error) {
    context.response.status = 422;
    // Only application-authored messages, never provider or infrastructure errors.
    const messages = [
      "Confirma tu contraseña actual o utiliza el enlace enviado a tu correo.",
      "La contraseña debe tener entre 12 y 128 caracteres y coincidir con su confirmación.",
      "No pudimos cambiar la contraseña. Confirma tu acceso e inténtalo nuevamente.",
      "Demasiados intentos. Inténtalo más tarde.",
    ];
    return {
      error:
        error instanceof Error && messages.includes(error.message)
          ? error.message
          : "No pudimos cambiar la contraseña. Confirma tu acceso e inténtalo nuevamente.",
    };
  }
}
