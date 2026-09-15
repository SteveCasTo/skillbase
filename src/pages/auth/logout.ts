import type { APIRoute } from "astro";

import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { privateNoStoreResponse } from "@/server/auth/route-policy";
import { getServerEnvironment } from "@/server/environment";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const environment = getServerEnvironment();
  if (!requestHasExpectedOrigin(request, environment.siteUrl))
    return privateNoStoreResponse("Invalid request origin", { status: 403 });
  await locals.supabase.auth.signOut({ scope: "local" });
  return redirect("/login?status=signed_out", 303);
};
