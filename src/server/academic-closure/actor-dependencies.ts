import { eq, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { AttendanceTransaction } from "@/server/db/repositories/attendance-calendar";
/** ADMIN lifecycle owner composes this with existing actor/dependency checks.
 * UUID references are restrictive; never delete history to enable account deletion. */
export const closureActorDependencies = {
  versions: s.academicClosureVersions.actorId,
  reopenings: s.academicGroupReopenings.actorId,
  receipts: s.academicClosureReceipts.actorId,
} as const;
export async function hasClosureActorActivity(
  tx: AttendanceTransaction,
  actorId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({
      used: sql<boolean>`exists(select 1 from ${s.academicClosureVersions} where ${eq(s.academicClosureVersions.actorId, actorId)}) or exists(select 1 from ${s.academicGroupReopenings} where ${eq(s.academicGroupReopenings.actorId, actorId)}) or exists(select 1 from ${s.academicClosureReceipts} where ${eq(s.academicClosureReceipts.actorId, actorId)})`,
    })
    .from(s.users)
    .where(eq(s.users.id, actorId));
  return row?.used ?? false;
}
