import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import { isGoogleAssociated } from "@/domain/auth/identity";
import { accountIdentity } from "@/server/auth/identity";
import {
  loadRequestAuthContext,
  requireRequestSupabaseClient,
} from "@/server/auth/context";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { privateNoStoreResponse } from "@/server/auth/route-policy";
import {
  consumeAuthAttempt,
  signAuthProof,
  setAuthCookie,
} from "@/server/auth/security";
import { getPublicAuthEnvironment } from "@/server/environment";
import { getDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";

export const POST: APIRoute = async ({
  request,
  locals,
  cookies,
  redirect,
  clientAddress,
}) => {
  const environment = getPublicAuthEnvironment();
  if (!requestHasExpectedOrigin(request, environment.siteUrl))
    return privateNoStoreResponse("Invalid request origin", { status: 403 });
  try {
    const supabase = requireRequestSupabaseClient(locals);
    const repository = new DrizzleAuthUserRepository(getDatabase());
    const auth = await loadRequestAuthContext(supabase, repository);
    if (!auth.internalUser || !auth.authUser || !auth.session)
      return privateNoStoreResponse("Forbidden", { status: 403 });
    cookies.delete("auth-link-proof", { path: "/" });
    if (isGoogleAssociated(auth.internalUser, accountIdentity(auth.authUser)))
      return redirect("/app/perfil?status=linked", 303);
    if (
      !(await consumeAuthAttempt(
        clientAddress,
        "link",
        auth.internalUser.email,
      ))
    )
      return redirect("/app/perfil?error=link", 303);
    const options = {
      redirectTo: new URL("/auth/callback", environment.siteUrl).toString(),
      queryParams: { prompt: "select_account" },
    };
    // linkIdentity refuses identities already attached by native automatic
    // linking. In that case require a fresh Google confirmation instead; never
    // grant app approval just because an identity appears in getUser().
    const nativeGoogle = auth.authUser.identities?.some(
      (identity) => identity.provider === "google",
    );
    const { data, error } = nativeGoogle
      ? await supabase.auth.signInWithOAuth({ provider: "google", options })
      : await supabase.auth.linkIdentity({ provider: "google", options });
    if (error || !data.url || !data.flowId)
      return redirect("/app/perfil?error=link", 303);
    const nonce = randomUUID();
    await repository.createGoogleLinkRequest(
      nonce,
      auth.internalUser.id,
      auth.session.id,
    );
    setAuthCookie(
      cookies,
      "auth-link-proof",
      signAuthProof(
        JSON.stringify({
          authUserId: auth.authUser.id,
          sessionId: auth.session.id,
          nonce,
          flowId: data.flowId,
          existingGoogleIdentityIds:
            auth.authUser.identities
              ?.filter((identity) => identity.provider === "google")
              .map((identity) => identity.id) ?? [],
        }),
      ),
    );
    return redirect(data.url, 303);
  } catch {
    return redirect("/app/perfil?error=link", 303);
  }
};
