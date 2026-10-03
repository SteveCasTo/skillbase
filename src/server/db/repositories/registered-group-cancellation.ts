import { and, asc, eq } from "drizzle-orm";
import type { RegisteredGroupCancellationResult } from "@/application/pre-registrations/registration-repository";
import * as schema from "@/server/db/schema";
import { registrationFinance } from "@/domain/pre-registrations/finance";
import {
  ledgerEntries,
  nextRegistrationVersion,
  priceDto,
  registrationAudit,
  requireFreshRegistrationActor,
  type RegistrationTransaction,
} from "./registration-support";

/** Called only with the shared gate, course and group already locked. No fictitious cash. */
export async function cancelRegisteredGroup(
  tx: RegistrationTransaction,
  courseId: string,
  groupId: string,
  actorId: string,
  now: Date,
): Promise<RegisteredGroupCancellationResult> {
  const rows = await tx
    .select()
    .from(schema.preRegistrations)
    .where(
      and(
        eq(schema.preRegistrations.courseId, courseId),
        eq(schema.preRegistrations.groupId, groupId),
        eq(schema.preRegistrations.state, "ACTIVE"),
      ),
    )
    .orderBy(asc(schema.preRegistrations.id))
    .for("update");
  if (rows.length) await requireFreshRegistrationActor(tx, actorId);
  let refundDueCents = 0;
  for (const row of rows) {
    const finance = registrationFinance(
      priceDto(row),
      "CANCELLED",
      await ledgerEntries(tx, row.id),
    );
    refundDueCents += finance.refundDueCents;
    await tx
      .update(schema.preRegistrations)
      .set({
        state: "CANCELLED",
        cancelledAt: now,
        cancelledBy: actorId,
        cancellationReason: "GROUP_CANCELLED",
        cancellationNote: "Cancelación administrativa del grupo",
        updatedAt: nextRegistrationVersion(row.updatedAt, now),
      })
      .where(eq(schema.preRegistrations.id, row.id));
    await registrationAudit(tx, actorId, row.id, "PRE_REGISTRATION_CANCELLED", {
      reason: "GROUP_CANCELLED",
      groupId,
      refundDueCents: finance.refundDueCents,
    });
  }
  return {
    cancelledRegistrationIds: rows.map((row) => row.id),
    refundDueCents,
  };
}
