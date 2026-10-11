import type { AstroCookies } from "astro";

const cookieName = "skillbase-oauth-login-notice";

/** Feedback only: callers must complete OAuth authorization before setting it. */
export function setOAuthLoginNotice(
  cookies: AstroCookies,
  url: URL,
  authUserId: string,
): void {
  cookies.set(
    cookieName,
    JSON.stringify({
      authUserId,
      origin: url.origin,
      expires: Date.now() + 60000,
    }),
    {
      path: "/app",
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      maxAge: 60,
    },
  );
}

/** Called only by the authorized private layout; consume once, never grant access. */
export function consumeOAuthLoginNotice(
  cookies: AstroCookies,
  url: URL,
  authUserId: string | null,
): boolean {
  const raw = cookies.get(cookieName)?.value;
  if (!raw) return false;
  cookies.delete(cookieName, { path: "/app" });
  try {
    const notice: unknown = JSON.parse(raw);
    return (
      typeof notice === "object" &&
      notice !== null &&
      "authUserId" in notice &&
      notice.authUserId === authUserId &&
      "origin" in notice &&
      notice.origin === url.origin &&
      "expires" in notice &&
      typeof notice.expires === "number" &&
      notice.expires > Date.now()
    );
  } catch {
    return false;
  }
}
