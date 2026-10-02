import type { APIContext } from "astro";
import { isAuthApiError } from "@supabase/supabase-js";
import {
  changeAccountPassword,
  PasswordChangeError,
} from "@/application/auth/change-password";
import { hasRecentGooglePasswordProof } from "@/domain/auth/password-proof";
import { accountHasPassword, hasLiveAccountSession } from "./password-presence";
import {
  isGoogleAssociated,
  sessionFromVerifiedClaims,
} from "@/domain/auth/identity";
import { accountIdentity } from "./identity";
import {
  loadRequestAuthContext,
  requireInternalUser,
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

export async function loadPasswordEditorState(
  context: Pick<APIContext, "locals" | "cookies">,
) {
  const user = requireInternalUser(context.locals);
  const supabase = requireRequestSupabaseClient(context.locals);
  if (!context.locals.authUser) throw new Error("Verified account is required");
  const identity = accountIdentity(context.locals.authUser);
  const hasPassword = await accountHasPassword(user, identity);
  const { data: claims, error } = await supabase.auth.getClaims();
  const verifiedSession = error
    ? null
    : sessionFromVerifiedClaims(claims?.claims, identity.id);
  const live =
    verifiedSession &&
    (await hasLiveAccountSession(user, identity, verifiedSession.id));
  const { data: session } = await supabase.auth.getSession();
  const hasRecoveryProof = Boolean(
    live &&
    verifiedSession?.method === "EMAIL_CONFIRMATION" &&
    session.session &&
    readAuthProof(context.cookies.get("auth-password-proof")?.value) ===
      sessionProofValue(identity.id, session.session.access_token),
  );
  return {
    hasPassword,
    hasRecoveryProof,
    needsGoogle:
      !hasPassword &&
      !hasRecoveryProof &&
      (!live || !hasRecentGooglePasswordProof(user, identity, claims?.claims)),
  };
}

export async function updateProfilePassword(
  context: ProfileContext,
): Promise<{ error: string | null; fields?: Record<string, string> }> {
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
      !auth.session ||
      !(await hasLiveAccountSession(
        auth.internalUser,
        accountIdentity(auth.authUser),
        auth.session.id,
      ))
    )
      throw new PasswordChangeError(
        "Tu sesión ya no está activa. Vuelve a iniciar sesión e inténtalo nuevamente.",
      );
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
      auth.session?.method === "EMAIL_CONFIRMATION" &&
      session.session &&
      proof ===
        sessionProofValue(auth.authUser.id, session.session.access_token),
    );
    const hasPassword = await accountHasPassword(
      auth.internalUser,
      accountIdentity(auth.authUser),
    );
    const { data: claims, error: claimsError } =
      await supabase.auth.getClaims();
    const hasGoogleProof =
      !hasPassword &&
      !claimsError &&
      hasRecentGooglePasswordProof(
        auth.internalUser,
        accountIdentity(auth.authUser),
        claims?.claims,
      );
    if (!hasPassword && !hasRecoveryProof && !hasGoogleProof)
      throw new PasswordChangeError(
        "Vuelve a iniciar sesión con Google para confirmar tu acceso y crear una contraseña.",
      );
    await changeAccountPassword(
      auth.internalUser,
      {
        password: form.get("password") ?? "",
        confirmation: form.get("confirmation") ?? "",
        currentPassword: form.get("currentPassword") ?? "",
        hasRecoveryProof,
        hasGoogleProof,
      },
      {
        async verifyCurrentPassword(email, password, authUserId) {
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (error) {
            if (isAuthApiError(error) && error.code === "invalid_credentials")
              return false;
            throw new Error(
              "No pudimos cambiar la contraseña. Confirma tu acceso e inténtalo nuevamente.",
            );
          }
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
            latest.internalUser.id !== auth.internalUser!.id ||
            latest.authUser?.id !== auth.authUser!.id ||
            !latest.session ||
            !(await hasLiveAccountSession(
              latest.internalUser,
              accountIdentity(latest.authUser),
              latest.session.id,
            ))
          )
            return false;
          if (hasGoogleProof) {
            const { data, error } = await supabase.auth.getClaims();
            if (
              error ||
              !hasRecentGooglePasswordProof(
                latest.internalUser,
                accountIdentity(latest.authUser!),
                data?.claims,
              ) ||
              (await accountHasPassword(
                latest.internalUser,
                accountIdentity(latest.authUser!),
              ))
            )
              throw new PasswordChangeError(
                "Vuelve a iniciar sesión con Google para confirmar tu acceso y crear una contraseña.",
              );
          }
          const google = accountIdentity(auth.authUser!).identities.find(
            (entry) => entry.provider === "google",
          );
          if (
            !hasPassword &&
            (hasGoogleProof || hasRecoveryProof) &&
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
          if (isAuthApiError(error) && error.code === "same_password")
            throw new PasswordChangeError(
              "La nueva contraseña debe ser diferente de la actual.",
              "password",
            );
          return !error;
        },
        async recordPasswordChanged(actorId) {
          await repository.recordPasswordChanged(actorId);
        },
      },
    );
    context.cookies.delete("auth-password-proof", { path: "/" });
    return { error: null };
  } catch (error) {
    context.response.status = 422;
    if (error instanceof PasswordChangeError)
      return {
        error: error.message,
        fields: error.field ? { [error.field]: error.message } : {},
      };
    // Only application-authored messages, never provider or infrastructure errors.
    const messages = [
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
