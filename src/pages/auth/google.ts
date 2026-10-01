import type { APIRoute } from "astro";

import {
  requestHasExpectedOrigin,
  safeRelativeRedirect,
} from "@/server/auth/redirects";
import { requireRequestSupabaseClient } from "@/server/auth/context";
import { privateNoStoreResponse } from "@/server/auth/route-policy";
import { getPublicAuthEnvironment } from "@/server/environment";
import { consumeAuthAttempt, readAuthForm } from "@/server/auth/security";

export const POST: APIRoute = async ({
  request,
  cookies,
  locals,
  redirect,
  clientAddress,
}) => {
  const environment = getPublicAuthEnvironment();
  const supabase = requireRequestSupabaseClient(locals);
  if (!requestHasExpectedOrigin(request, environment.siteUrl))
    return privateNoStoreResponse("Invalid request origin", { status: 403 });

  let form: URLSearchParams;
  try {
    if (!(await consumeAuthAttempt(clientAddress, "oauth")))
      return redirect("/login?error=oauth_start", 303);
    form = await readAuthForm(request);
  } catch {
    return redirect("/login?error=oauth_start", 303);
  }
  cookies.delete("auth-link-proof", { path: "/" });
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
