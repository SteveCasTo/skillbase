import { defineMiddleware } from "astro:middleware";

import { requireRoles } from "@/application/auth/authorize";
import { AuthorizationError } from "@/domain/auth/errors";
import { loadRequestAuthContext } from "@/server/auth/context";
import { loginRedirect } from "@/server/auth/redirects";
import {
  applyPrivateNoStore,
  getPrivateRoutePolicy,
  isPrivatePath,
  isSessionDependentPath,
} from "@/server/auth/route-policy";
import { createRequestSupabaseClient } from "@/server/auth/supabase";
import { getDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { getServerEnvironment } from "@/server/environment";

export const onRequest = defineMiddleware(async (context, next) => {
  const environment = getServerEnvironment();
  const responseHeaders = new Headers();
  const supabase = createRequestSupabaseClient(
    { ...context, responseHeaders },
    environment,
  );
  const repository = new DrizzleAuthUserRepository(getDatabase());
  const auth = await loadRequestAuthContext(supabase, repository);
  context.locals.supabase = supabase;
  context.locals.authUser = auth.authUser;
  context.locals.internalUser = auth.internalUser;
  context.locals.authError = auth.error;

  const { pathname, search } = context.url;
  let response: Response;
  if (pathname === "/login" && auth.internalUser) {
    response = context.redirect("/app", 303);
  } else if (!isPrivatePath(pathname)) {
    response = await next();
  } else if (!auth.authUser) {
    response = context.redirect(loginRedirect(pathname, search), 303);
  } else if (!auth.internalUser) {
    response = context.redirect(
      `/unauthorized?reason=${auth.error?.code.toLowerCase() ?? "not_invited"}`,
      303,
    );
  } else {
    const policy = getPrivateRoutePolicy(pathname);
    if (!policy) {
      response = context.redirect("/unauthorized?reason=forbidden", 303);
    } else if (policy.access === "ROLES") {
      try {
        requireRoles(auth.internalUser, policy.roles);
        response = await next();
      } catch (error) {
        if (!(error instanceof AuthorizationError)) throw error;
        response = context.redirect("/unauthorized?reason=forbidden", 303);
      }
    } else {
      response = await next();
    }
  }
  for (const [name, value] of responseHeaders)
    response.headers.set(name, value);
  if (isSessionDependentPath(pathname)) applyPrivateNoStore(response);
  return response;
});
