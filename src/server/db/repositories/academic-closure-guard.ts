import { eq } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { AttendanceTransaction } from "./attendance-calendar";

/** Call only after the existing schedule gate and parent course/group locks.
 * Missing state means OPEN. The shared gate also protects lazy state creation. */
export async function academicGroupClosed(
  tx: AttendanceTransaction,
  groupId: string,
): Promise<boolean> {
  const [state] = await tx
    .select({ closed: s.academicGroupStates.closed })
    .from(s.academicGroupStates)
    .where(eq(s.academicGroupStates.groupId, groupId));
  return state?.closed ?? false;
}
