import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/server/db/schema";
import { InterestError } from "@/domain/interests/rules";
export type InterestRateConfig = {
  secret: string;
  courseLimit: number;
  courseSeconds: number;
  networkLimit: number;
  networkSeconds: number;
};
export function rateConfig(
  env: Record<string, string | undefined> = process.env,
): InterestRateConfig {
  const secret = env.INTEREST_RATE_LIMIT_SECRET;
  if (!secret || secret.length < 32)
    throw new InterestError(
      "SERVICE_UNAVAILABLE",
      503,
      "No se pudo completar la solicitud. Intenta nuevamente.",
    );
  const integer = (key: string, fallback: number) => {
    const raw = env[key];
    const value = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483646)
      throw new Error("Invalid interest rate configuration");
    return value;
  };
  return {
    secret,
    courseLimit: integer("INTEREST_RATE_COURSE_LIMIT", 20),
    courseSeconds: integer("INTEREST_RATE_COURSE_SECONDS", 600),
    networkLimit: integer("INTEREST_RATE_NETWORK_LIMIT", 100),
    networkSeconds: integer("INTEREST_RATE_NETWORK_SECONDS", 3600),
  };
}
export function networkDigest(address: string, secret: string): string {
  if (!isIP(address))
    throw new InterestError(
      "SERVICE_UNAVAILABLE",
      503,
      "No se pudo completar la solicitud. Intenta nuevamente.",
    );
  // URL normalizes equivalent IPv6 representations and mapped IPv4 is handled consistently.
  let canonical =
    isIP(address) === 6
      ? new URL(`http://[${address}]/`).hostname.toLowerCase()
      : address;
  const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/u.exec(
    canonical,
  );
  if (mapped) {
    const high = Number.parseInt(mapped[1]!, 16);
    const low = Number.parseInt(mapped[2]!, 16);
    canonical = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return createHmac("sha256", secret).update(canonical).digest("hex");
}
export async function consumeInterestRateLimit(
  db: PostgresJsDatabase<typeof schema>,
  address: string,
  slug: string,
  config = rateConfig(),
): Promise<number> {
  const digest = networkDigest(address, config.secret);
  const courseKey = createHmac("sha256", config.secret)
    .update(slug)
    .digest("hex");
  return db.transaction(async (tx) => {
    const [clock] = await tx.execute<{ seconds: number }>(
      sql`select extract(epoch from clock_timestamp())::double precision as seconds`,
    );
    if (!clock) throw new Error("No database clock");
    let retry = 0;
    // Global first then course: stable order across independent server instances.
    for (const scope of [
      {
        key: `network:${digest}`,
        seconds: config.networkSeconds,
        limit: config.networkLimit,
      },
      {
        key: `course:${digest}:${courseKey}`,
        seconds: config.courseSeconds,
        limit: config.courseLimit,
      },
    ]) {
      const window = Math.floor(clock.seconds / scope.seconds) * scope.seconds;
      const key = `${scope.key}:${window}`;
      const [bucket] = await tx.execute<{ attempts: number }>(
        sql`insert into interest_registration_rate_limits (key,attempts,expires_at) values (${key},1,to_timestamp(${window + scope.seconds})) on conflict (key) do update set attempts = least(interest_registration_rate_limits.attempts + 1, ${scope.limit + 1}) returning attempts`,
      );
      if (!bucket) throw new Error("No rate bucket");
      if (bucket.attempts > scope.limit)
        retry = Math.max(
          retry,
          Math.ceil(window + scope.seconds - clock.seconds),
        );
    }
    await tx.execute(
      sql`delete from interest_registration_rate_limits where key in (select key from interest_registration_rate_limits where expires_at < clock_timestamp() order by expires_at limit 100 for update skip locked)`,
    );
    return retry;
  });
}
