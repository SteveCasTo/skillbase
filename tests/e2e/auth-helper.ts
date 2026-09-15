import type { BrowserContext } from "@playwright/test";
import { createServerClient, type CookieOptionsWithName } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

interface CapturedCookie {
  readonly name: string;
  readonly value: string;
  readonly options: CookieOptionsWithName;
}

export async function signInFixture(
  context: BrowserContext,
  email: string,
): Promise<void> {
  const environment = getTestSupabaseEnvironment();
  const admin = createClient(environment.apiUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw linkError;
  let cookies: CapturedCookie[] = [];
  const supabase = createServerClient(
    environment.apiUrl,
    environment.publishableKey,
    {
      cookies: {
        getAll: () => cookies,
        setAll: (nextCookies) => {
          cookies = nextCookies;
        },
      },
    },
  );
  const { error } = await supabase.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (error) throw error;
  await context.addCookies(
    cookies.map(({ name, value, options }) => ({
      name,
      value,
      domain: "127.0.0.1",
      path: options.path ?? "/",
      httpOnly: options.httpOnly ?? false,
      secure: options.secure ?? false,
      sameSite:
        options.sameSite === "strict"
          ? ("Strict" as const)
          : options.sameSite === "none"
            ? ("None" as const)
            : ("Lax" as const),
    })),
  );
}
