const DEFAULT_PRIVATE_PATH = "/app";

export function safeRelativeRedirect(
  candidate: string | null | undefined,
  fallback = DEFAULT_PRIVATE_PATH,
): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//"))
    return fallback;
  try {
    const parsed = new URL(candidate, "http://local.invalid");
    if (
      parsed.origin !== "http://local.invalid" ||
      parsed.pathname.includes("\\")
    )
      return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function loginRedirect(pathname: string, search = ""): string {
  const next = safeRelativeRedirect(
    `${pathname}${search}`,
    DEFAULT_PRIVATE_PATH,
  );
  return `/login?next=${encodeURIComponent(next)}`;
}

export function requestHasExpectedOrigin(
  request: Request,
  siteUrl: URL,
): boolean {
  const origin = request.headers.get("origin");
  return origin === siteUrl.origin;
}
