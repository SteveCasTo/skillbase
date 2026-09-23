import type { APIRoute } from "astro";

import {
  requestHasExpectedOrigin,
  safeRelativeRedirect,
} from "@/server/auth/redirects";
import { requireRequestSupabaseClient } from "@/server/auth/context";
import { privateNoStoreResponse } from "@/server/auth/route-policy";
import { getPublicAuthEnvironment } from "@/server/environment";

export const POST: APIRoute = async ({
  request,
  cookies,
  locals,
  redirect,
}) => {
  const environment = getPublicAuthEnvironment();
  const supabase = requireRequestSupabaseClient(locals);
  if (!requestHasExpectedOrigin(request, environment.siteUrl))
    return privateNoStoreResponse("Invalid request origin", { status: 403 });

  const form = await request.formData();
  const nextValue = form.get("next");
  const next = safeRelativeRedirect(
    typeof nextValue === "string" ? nextValue : null,
  );
  cookies.set("auth-next", next, {
    httpOnly: true,
    sameSite: "lax",
    secure: environment.siteUrl.protocol === "https:",
    path: "/auth",
    maxAge: 600,
  });
  const redirectTo = new URL("/auth/callback", environment.siteUrl).toString();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error || !data.url) return redirect("/login?error=oauth_start", 303);
  return redirect(data.url, 303);
};
