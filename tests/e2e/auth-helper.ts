import type { BrowserContext } from "@playwright/test";
import { createServerClient, type CookieOptionsWithName } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { authAttemptBuckets } from "@/server/db/schema";

import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import {
  oauthFixtureClient,
  prepareOAuthFixtureCode,
  prepareProviderCodeFixture,
} from "../fixtures/oauth-provider";

interface CapturedCookie {
  readonly name: string;
  readonly value: string;
  readonly options: CookieOptionsWithName;
}

/** Isolate a serial scenario's loopback login budget, never account limits. */
export async function resetLoginNetworkBudgetFixture(): Promise<void> {
  const environment = getTestSupabaseEnvironment();
  const secret = process.env.AUTH_RATE_LIMIT_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Isolated Auth fixture configuration unavailable");
  const key = createHmac("sha256", secret)
    .update("network:127.0.0.1:login")
    .digest("hex");
  const database = createDatabase(environment.databaseUrl);
  try {
    await database.db
      .delete(authAttemptBuckets)
      .where(eq(authAttemptBuckets.key, key));
  } finally {
    await database.close();
  }
}

/** Simulates email confirmation at the provider boundary, not SMTP delivery. */
export async function prepareBrowserRecoveryFixture(
  context: BrowserContext,
  authUserId: string,
  siteUrl: string,
): Promise<{ code: string; flowId: string }> {
  const environment = getTestSupabaseEnvironment();
  const all = new Map(
    (await context.cookies()).map(({ name, value }) => [name, value]),
  );
  const changed = new Map<string, CapturedCookie>();
  const ssr = createServerClient(
    environment.apiUrl,
    environment.publishableKey,
    {
      cookieOptions: { httpOnly: true, sameSite: "lax", path: "/" },
      cookies: {
        getAll: () => [...all].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          for (const cookie of cookies) {
            all.set(cookie.name, cookie.value);
            changed.set(cookie.name, cookie);
          }
        },
      },
    },
  );
  const { data, error } = await ssr.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: new URL("/auth/recovery", siteUrl).toString() },
  });
  const challenge = data.url
    ? new URL(data.url).searchParams.get("code_challenge")
    : null;
  if (error || !challenge || !data.flowId)
    throw new Error("Recovery confirmation fixture verifier is unavailable");
  await context.addCookies(
    [...changed.values()].map(({ name, value, options }) => ({
      name,
      value,
      domain: "127.0.0.1",
      path: options.path ?? "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    })),
  );
  return {
    code: await prepareProviderCodeFixture(authUserId, challenge, "recovery"),
    flowId: data.flowId,
  };
}

export async function signInOAuthFixture(
  context: BrowserContext,
  authUserId: string,
): Promise<void> {
  const environment = getTestSupabaseEnvironment();
  const fixture = oauthFixtureClient();
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  fixture.setVerifier(verifier);
  const code = await prepareOAuthFixtureCode(authUserId, verifier);
  const { data, error } =
    await fixture.client.auth.exchangeCodeForSession(code);
  if (error || !data.session)
    throw new Error("Isolated OAuth fixture exchange failed");
  let cookies: CapturedCookie[] = [];
  const ssr = createServerClient(
    environment.apiUrl,
    environment.publishableKey,
    {
      cookieOptions: { httpOnly: true, sameSite: "lax", path: "/" },
      cookies: {
        getAll: () => cookies,
        setAll: (values) => {
          cookies = values;
        },
      },
    },
  );
  const verified = await ssr.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (verified.error) throw new Error("Isolated OAuth fixture cookies failed");
  await context.addCookies(
    cookies.map(({ name, value, options }) => ({
      name,
      value,
      domain: "127.0.0.1",
      path: options.path ?? "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    })),
  );
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
