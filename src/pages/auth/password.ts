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
  try {
    const form = await readAuthForm(request);
    const email = normalizeEmail(form.get("email") ?? "");
    const password = form.get("password") ?? "";
    if (
      !email ||
      email.length > 254 ||
      !password ||
      password.length > 128 ||
      !(await consumeAuthAttempt(clientAddress, "login", email))
    )
      return redirect("/login?error=credentials", 303);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return redirect("/login?error=credentials", 303);
    const context = await loadRequestAuthContext(
      supabase,
      new DrizzleAuthUserRepository(getDatabase()),
    );
    if (!context.internalUser) {
      await supabase.auth.signOut({ scope: "local" });
      return redirect("/login?error=credentials", 303);
    }
    return redirect(safeRelativeRedirect(form.get("next")), 303);
  } catch {
    return redirect("/login?error=credentials", 303);
  }
};
