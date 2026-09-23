import type { APIRoute } from "astro";

import { requireRequestSupabaseClient } from "@/server/auth/context";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { privateNoStoreResponse } from "@/server/auth/route-policy";
import { getPublicAuthEnvironment } from "@/server/environment";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const environment = getPublicAuthEnvironment();
  if (!requestHasExpectedOrigin(request, environment.siteUrl))
    return privateNoStoreResponse("Invalid request origin", { status: 403 });
  await requireRequestSupabaseClient(locals).auth.signOut({ scope: "local" });
  return redirect("/login?status=signed_out", 303);
};
