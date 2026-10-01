import type { APIRoute } from "astro";

import { completeOAuthCallback } from "@/application/auth/complete-oauth-callback";
import { requireRequestSupabaseClient } from "@/server/auth/context";
import { safeRelativeRedirect } from "@/server/auth/redirects";
import { getDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import {
  requireApprovedProviders,
  type VerifiedAuthSession,
} from "@/domain/auth/identity";
import { normalizeEmail } from "@/domain/auth/policies";
import { accountIdentity } from "@/server/auth/identity";
import { consumeAuthAttempt } from "@/server/auth/security";
import { loadVerifiedAuthSession } from "@/server/auth/session";
import { finishGoogleAssociation } from "@/server/auth/google-association";

export const GET: APIRoute = async ({
  url,
  cookies,
  locals,
  redirect,
  clientAddress,
}) => {
  const supabase = requireRequestSupabaseClient(locals);
  const code = url.searchParams.get("code");
  try {
    if (!(await consumeAuthAttempt(clientAddress, "callback")))
      return redirect("/login?error=oauth_callback", 303);
  } catch {
    return redirect("/login?error=oauth_callback", 303);
  }
  const repository = new DrizzleAuthUserRepository(getDatabase());
  const linkCookie = cookies.get("auth-link-proof")?.value;
  cookies.delete("auth-link-proof", { path: "/" });
  if (linkCookie) {
    return redirect(
      await finishGoogleAssociation(supabase, repository, linkCookie, code),
      303,
    );
  }
  if (!code) return redirect("/login?error=oauth_callback", 303);
  const result = await completeOAuthCallback(
    {
      async exchangeCode(value) {
        const flowId = url.searchParams.get("sb_flow_id");
        const { error } = await supabase.auth.exchangeCodeForSession(
          value,
          flowId ? { flowId } : undefined,
        );
        return !error;
      },
      async getIdentity() {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user?.email) return null;
        const identity = accountIdentity(data.user);
        let session: VerifiedAuthSession;
        try {
          session = await loadVerifiedAuthSession(supabase, data.user.id);
        } catch {
          return null;
        }
        if (session.method !== "OAUTH") return null;
        const internal = await repository.findByAuthUserId(data.user.id);
        if (internal) {
          try {
            requireApprovedProviders(internal, identity, session);
          } catch {
            return null;
          }
        } else if (
          identity.identities.some((entry) => entry.provider !== "google")
        )
          return null;
        if (
          !identity.identities.some(
            (entry) =>
              entry.provider === "google" &&
              entry.verified &&
              normalizeEmail(entry.email) === normalizeEmail(identity.email),
          )
        )
          return null;
        return {
          authUserId: data.user.id,
          email: data.user.email,
          emailVerified: Boolean(data.user.email_confirmed_at),
          providers:
            data.user.identities?.map(({ provider }) => provider) ?? [],
        };
      },
      async signOutCurrent() {
        await supabase.auth.signOut({ scope: "local" });
      },
    },
    repository,
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
