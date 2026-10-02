import type { APIRoute } from "astro";
import {
  loadRequestAuthContext,
  requireRequestSupabaseClient,
} from "@/server/auth/context";
import {
  requestHasExpectedOrigin,
  safeRelativeRedirect,
} from "@/server/auth/redirects";
import { privateNoStoreResponse } from "@/server/auth/route-policy";
import { consumeAuthAttempt, readAuthForm } from "@/server/auth/security";
import { normalizeEmail } from "@/domain/auth/policies";
import { getPublicAuthEnvironment } from "@/server/environment";
import { getDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";

export const POST: APIRoute = async ({
  request,
  locals,
  redirect,
  clientAddress,
}) => {
  if (!requestHasExpectedOrigin(request, getPublicAuthEnvironment().siteUrl))
    return privateNoStoreResponse("Invalid request origin", { status: 403 });
  const supabase = requireRequestSupabaseClient(locals);
  const json = request.headers.get("accept")?.includes("application/json");
  const failure = () =>
    json
      ? privateNoStoreResponse(
          JSON.stringify({
            error:
              "No pudimos iniciar la sesión. Revisa tu correo y contraseña e inténtalo nuevamente.",
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        )
      : redirect("/login?error=credentials", 303);
  try {
    const form = await readAuthForm(request);
    const email = normalizeEmail(form.get("email") ?? "");
    const password = form.get("password") ?? "";
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
      email.length > 254 ||
      !password ||
      password.length > 128 ||
      !(await consumeAuthAttempt(clientAddress, "login", email))
    )
      return failure();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return failure();
    const context = await loadRequestAuthContext(
      supabase,
      new DrizzleAuthUserRepository(getDatabase()),
    );
    if (!context.internalUser) {
      await supabase.auth.signOut({ scope: "local" });
      return failure();
    }
    const next = safeRelativeRedirect(form.get("next"));
    if (json)
      return privateNoStoreResponse(JSON.stringify({ redirect: next }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    return redirect(next, 303);
  } catch {
    return failure();
  }
};
