import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { sql } from "drizzle-orm";
import type { AstroCookies } from "astro";
import { getDatabase } from "@/server/db/client";
import { getPublicAuthEnvironment } from "@/server/environment";

function secret(): string {
  const value = process.env.AUTH_RATE_LIMIT_SECRET?.trim();
  if (!value || value.length < 32)
    throw new Error("Auth security configuration is unavailable");
  return value;
}

function digest(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function signAuthProof(
  value: string,
  expiresAt = Date.now() + 300_000,
): string {
  const payload = Buffer.from(JSON.stringify({ value, expiresAt })).toString(
    "base64url",
  );
  return `${payload}.${digest(payload)}`;
}

export function readAuthProof(token: string | undefined): string | null {
  if (!token || token.length > 2048) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !/^[a-f0-9]{64}$/u.test(signature)) return null;
  if (
    !timingSafeEqual(
      new TextEncoder().encode(signature),
      new TextEncoder().encode(digest(payload)),
    )
  )
    return null;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    );
    if (
      !decoded ||
      typeof decoded !== "object" ||
      !("expiresAt" in decoded) ||
      !("value" in decoded)
    )
      return null;
    return typeof decoded.expiresAt === "number" &&
      decoded.expiresAt > Date.now() &&
      typeof decoded.value === "string"
      ? decoded.value
      : null;
  } catch {
    return null;
  }
}

export function sessionProofValue(userId: string, accessToken: string): string {
  return `${userId}:${digest(accessToken)}`;
}

export function setAuthCookie(
  cookies: AstroCookies,
  name: string,
  value: string,
): void {
  cookies.set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: getPublicAuthEnvironment().siteUrl.protocol === "https:",
    path: "/",
    maxAge: 300,
  });
}

export async function consumeAuthAttempt(
  address: string,
  action: string,
  email = "",
): Promise<boolean> {
  if (!isIP(address)) throw new Error("Trusted client address is unavailable");
  const now = new Date();
  const start = new Date(Math.floor(now.getTime() / 900_000) * 900_000);
  const keys = [
    digest(`network:${address}:${action}`),
    ...(email ? [digest(`account:${email}:${action}`)] : []),
  ];
  return getDatabase().transaction(async (tx) => {
    await tx.execute(
      sql`delete from auth_attempt_buckets where expires_at < ${now.toISOString()}::timestamptz`,
    );
    let allowed = true;
    for (const key of keys.sort()) {
      const rows = await tx.execute<{ attempts: number }>(sql`
        insert into auth_attempt_buckets (key, window_start, attempts, expires_at)
        values (${key}, ${start.toISOString()}::timestamptz, 1, ${new Date(start.getTime() + 1_800_000).toISOString()}::timestamptz)
        on conflict (key, window_start) do update set attempts = auth_attempt_buckets.attempts + 1
        returning attempts`);
      if ((rows[0]?.attempts ?? 100) > 10) allowed = false;
    }
    return allowed;
  });
}

export async function readAuthForm(request: Request): Promise<URLSearchParams> {
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !==
    "application/x-www-form-urlencoded"
  )
    throw new Error("Invalid form");
  const reader = request.body?.getReader();
  let text = "";
  let size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  if (reader)
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          throw new Error("Invalid form");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  const form = new URLSearchParams(text);
  const seen = new Set<string>();
  for (const [key] of form) {
    if (seen.has(key)) throw new Error("Invalid form");
    seen.add(key);
  }
  return form;
}
