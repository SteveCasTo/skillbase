import type { APIRoute } from "astro";
import {
  requireRequestSupabaseClient,
  loadRequestAuthContext,
} from "@/server/auth/context";
import { getDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { privateNoStoreResponse } from "@/server/auth/route-policy";
import { consumeAuthAttempt, readAuthForm } from "@/server/auth/security";
import { normalizeEmail } from "@/domain/auth/policies";
import { getPublicAuthEnvironment } from "@/server/environment";

export const POST: APIRoute = async ({
  request,
  locals,
  redirect,
  clientAddress,
}) => {
  const environment = getPublicAuthEnvironment();
  if (!requestHasExpectedOrigin(request, environment.siteUrl))
    return privateNoStoreResponse("Invalid request origin", { status: 403 });
  let returnToProfile = false;
  try {
    const form = await readAuthForm(request);
    if (form.get("returnTo") === "profile") {
      const auth = await loadRequestAuthContext(
        requireRequestSupabaseClient(locals),
        new DrizzleAuthUserRepository(getDatabase()),
      );
      returnToProfile = Boolean(auth.internalUser);
    }
    const email = normalizeEmail(form.get("email") ?? "");
    if (
      email.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) &&
      (await consumeAuthAttempt(clientAddress, "recovery", email))
    )
      await requireRequestSupabaseClient(locals).auth.resetPasswordForEmail(
        email,
        {
          redirectTo: new URL("/auth/recovery", environment.siteUrl).toString(),
        },
      );
  } catch {
    /* Identical result for unknown, throttled and provider failures. */
  }
  return redirect(
    returnToProfile
      ? "/app/perfil?status=recovery_sent"
      : "/login?status=recovery_sent",
    303,
  );
};
