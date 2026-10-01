import type { APIRoute } from "astro";
import {
  requireRequestSupabaseClient,
  loadRequestAuthContext,
} from "@/server/auth/context";
import {
  signAuthProof,
  setAuthCookie,
  sessionProofValue,
} from "@/server/auth/security";
import { getDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";

export const GET: APIRoute = async ({ url, locals, cookies, redirect }) => {
  const supabase = requireRequestSupabaseClient(locals);
  try {
    const code = url.searchParams.get("code");
    if (!code) return redirect("/login?error=recovery", 303);
    const flowId = url.searchParams.get("sb_flow_id");
    const { data, error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );
    if (error || !data.session) return redirect("/login?error=recovery", 303);
    const context = await loadRequestAuthContext(
      supabase,
      new DrizzleAuthUserRepository(getDatabase()),
    );
    if (!context.internalUser) {
      await supabase.auth.signOut({ scope: "local" });
      return redirect("/login?error=recovery", 303);
    }
    setAuthCookie(
      cookies,
      "auth-password-proof",
      signAuthProof(
        sessionProofValue(
          context.internalUser.authUserId!,
          data.session.access_token,
        ),
      ),
    );
    return redirect("/app/perfil?status=confirmed", 303);
  } catch {
    return redirect("/login?error=recovery", 303);
  }
};
