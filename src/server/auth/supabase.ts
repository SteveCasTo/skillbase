import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";

import type { PublicAuthEnvironment } from "@/server/environment";

export type RequestSupabaseClient = SupabaseClient;

interface RequestClientContext {
  readonly request: Request;
  readonly cookies: AstroCookies;
  readonly responseHeaders: Headers;
}

/** Astro's context includes lazy getters; forward only the cookie adapter's inputs. */
export function requestClientContext(
  context: Pick<RequestClientContext, "request" | "cookies">,
  responseHeaders: Headers,
): RequestClientContext {
  return {
    request: context.request,
    cookies: context.cookies,
    responseHeaders,
  };
}

export function getSupabaseCookieOptions(siteUrl: URL) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: siteUrl.protocol === "https:",
  };
}

export function createRequestSupabaseClient(
  context: RequestClientContext,
  environment: PublicAuthEnvironment,
): RequestSupabaseClient {
  const cookieOptions = getSupabaseCookieOptions(environment.siteUrl);
  return createServerClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    {
      auth: { flowType: "pkce" },
      cookieOptions,
      cookies: {
        getAll: () =>
          parseCookieHeader(context.request.headers.get("cookie") ?? ""),
        setAll(cookiesToSet, headers) {
          for (const { name, value, options } of cookiesToSet)
            context.cookies.set(name, value, {
              ...options,
              ...cookieOptions,
            });
          for (const [name, value] of Object.entries(headers))
            context.responseHeaders.set(name, value);
        },
      },
    },
  );
}
