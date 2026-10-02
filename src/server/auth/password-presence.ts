import { sql } from "drizzle-orm";
import {
  requireMatchingAccount,
  type AccountIdentity,
} from "@/domain/auth/identity";
import type { InternalUser } from "@/domain/auth/types";
import { getDatabase } from "@/server/db/client";

/** Only a boolean crosses this adapter. Never select or return the stored hash. */
export async function accountHasPassword(
  user: InternalUser,
  identity: AccountIdentity,
  database = getDatabase(),
): Promise<boolean> {
  requireMatchingAccount(user, identity);
  const rows = await database.execute<{ has_password: boolean }>(sql`
    select coalesce(encrypted_password <> '', false) as has_password
    from auth.users where id = ${identity.id}::uuid
  `);
  if (!rows[0] || typeof rows[0].has_password !== "boolean")
    throw new Error("Credential presence unavailable");
  return rows[0].has_password;
}

/** Signed JWTs can outlive logout. Sensitive writes also require a live actor-bound session. */
export async function hasLiveAccountSession(
  user: InternalUser,
  identity: AccountIdentity,
  sessionId: string,
  database = getDatabase(),
): Promise<boolean> {
  requireMatchingAccount(user, identity);
  const rows = await database.execute<{ active: boolean }>(sql`
    select exists(select 1 from auth.sessions
      where id = ${sessionId}::uuid and user_id = ${identity.id}::uuid
      and (not_after is null or not_after > now())) as active
  `);
  return rows[0]?.active === true;
}
