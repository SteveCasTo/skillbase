import type { APIRoute } from "astro";

import { completeOAuthCallback } from "@/application/auth/complete-oauth-callback";
import { safeRelativeRedirect } from "@/server/auth/redirects";
import { getDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";

export const GET: APIRoute = async ({ url, cookies, locals, redirect }) => {
  const code = url.searchParams.get("code");
  if (!code) return redirect("/login?error=oauth_callback", 303);
  const result = await completeOAuthCallback(
    {
      async exchangeCode(value) {
        const { error } =
          await locals.supabase.auth.exchangeCodeForSession(value);
        return !error;
      },
      async getIdentity() {
        const { data, error } = await locals.supabase.auth.getUser();
        if (error || !data.user?.email) return null;
        return {
          authUserId: data.user.id,
          email: data.user.email,
          emailVerified: Boolean(data.user.email_confirmed_at),
          providers:
            data.user.identities?.map(({ provider }) => provider) ?? [],
        };
      },
      async signOutCurrent() {
        await locals.supabase.auth.signOut({ scope: "local" });
      },
    },
    new DrizzleAuthUserRepository(getDatabase()),
    code,
  );
  if (!result.success) {
    if (result.reason === "oauth_callback")
      return redirect("/login?error=oauth_callback", 303);
    return redirect(
      `/unauthorized?reason=${encodeURIComponent(result.reason)}`,
      303,
    );
  }

  const next = safeRelativeRedirect(cookies.get("auth-next")?.value);
  cookies.delete("auth-next", { path: "/auth" });
  return redirect(next, 303);
};
