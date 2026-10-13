import { eq } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegistrationDatabase } from "@/server/db/repositories/registration-support";
import { resolveActiveUser, requireRoles } from "@/application/auth/authorize";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { lockInstructorSchedules } from "@/server/db/repositories/instructor-schedule";
import * as s from "@/server/db/schema";
import { FULL_VALIDATION_OWNER } from "./full-validation-seed-matrix";
import { fullValidationPlanHash } from "./full-validation-reset-plan";

const invitations = [
  {
    key: "admin-invited",
    email: "claudia.romero@example.test",
    name: "Claudia Romero Arias",
    role: "ADMIN" as const,
  },
  {
    key: "instructor-invited",
    email: "teresa.vargas@example.test",
    name: "Teresa Vargas Pizarro",
    role: "INSTRUCTOR" as const,
    profile: { firstName: "Teresa", lastName: "Vargas Pizarro", phone: null },
  },
] as const;

/** Legitimate internal invitations only: no Auth identity, email delivery,
 * credential, verification flag or provider configuration is manufactured. */
export async function seedValidationInvitations(
  db: RegistrationDatabase,
  auth: SupabaseClient,
  options: {
    actorId: string;
    operationId: string;
    apply: boolean;
    reviewedPlanSha256?: string;
  },
) {
  const [primary] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, options.actorId));
  if (!primary?.authUserId) throw new Error("Existing primary actor required");
  const identity = await auth.auth.admin.getUserById(primary.authUserId);
  if (identity.error || identity.data.user?.id !== primary.authUserId)
    throw new Error("Primary identity could not be verified");
  const actor = await resolveActiveUser(
    new DrizzleAuthUserRepository(db),
    primary.authUserId,
  );
  requireRoles(actor, ["ADMIN"]);
  const h = fullValidationPlanHash({
    owner: FULL_VALIDATION_OWNER,
    operationId: options.operationId,
    purpose: "invitations",
  });
  const receiptId = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  const [receipt] = await db
    .select()
    .from(s.auditEvents)
    .where(eq(s.auditEvents.id, receiptId));
  if (receipt) {
    if (
      receipt.actorId !== actor.id ||
      receipt.action !== "VALIDATION_INVITATIONS_CREATED" ||
      receipt.metadata.owner !== FULL_VALIDATION_OWNER ||
      (options.reviewedPlanSha256 &&
        receipt.metadata.planSha256 !== options.reviewedPlanSha256)
    )
      throw new Error("Invitation receipt conflicts");
    return {
      mode: "NOOP" as const,
      planSha256: String(receipt.metadata.planSha256),
    };
  }
  for (const invitation of invitations) {
    const [existing] = await db
      .select()
      .from(s.users)
      .where(eq(s.users.email, invitation.email));
    if (existing)
      throw new Error(
        "Unowned invitation email collision; no adoption or role replacement",
      );
  }
  for (let page = 1; ; page++) {
    const users = await auth.auth.admin.listUsers({ page, perPage: 100 });
    if (users.error)
      throw new Error("Auth invitation collision check unavailable");
    if (
      users.data.users.some((user) =>
        invitations.some((invite) => invite.email === user.email),
      )
    )
      throw new Error(
        "Existing Auth email cannot become a validation invitation",
      );
    if (users.data.users.length < 100) break;
  }
  const plan = {
    owner: FULL_VALIDATION_OWNER,
    operationId: options.operationId,
    actorId: actor.id,
    invitations,
  };
  const planSha256 = fullValidationPlanHash(plan);
  if (options.reviewedPlanSha256 && options.reviewedPlanSha256 !== planSha256)
    throw new Error("Reviewed invitation plan changed");
  if (!options.apply) return { mode: "PLAN" as const, planSha256, plan };
  if (!options.reviewedPlanSha256)
    throw new Error("Explicit invitation plan approval required");
  return db.transaction(async (tx) => {
    await lockInstructorSchedules(tx);
    const [reset] = await tx
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, options.operationId));
    if (
      reset?.actorId !== actor.id ||
      reset.action !== "VALIDATION_BUSINESS_RESET" ||
      reset.metadata.owner !== FULL_VALIDATION_OWNER
    )
      throw new Error("Approved reset receipt required before new invitations");
    const accounts = [];
    for (const invitation of invitations) {
      const [collision] = await tx
        .select()
        .from(s.users)
        .where(eq(s.users.email, invitation.email));
      if (collision) throw new Error("Concurrent invitation collision");
      const invited = await new DrizzleAuthUserRepository(tx).preprovision({
        email: invitation.email,
        name: invitation.name,
        roles: [invitation.role],
      });
      if (invited.authUserId !== null || invited.status !== "INVITED")
        throw new Error("Invitation acquired an unexpected verified identity");
      if ("profile" in invitation)
        await tx
          .insert(s.instructorProfiles)
          .values({ id: invited.id, ...invitation.profile });
      accounts.push({
        id: invited.id,
        status: invited.status,
        role: invitation.role,
      });
    }
    await tx.insert(s.auditEvents).values({
      id: receiptId,
      actorId: actor.id,
      entityType: "BUSINESS_MAINTENANCE",
      entityId: options.operationId,
      action: "VALIDATION_INVITATIONS_CREATED",
      metadata: {
        owner: FULL_VALIDATION_OWNER,
        planSha256,
        accounts: JSON.stringify(accounts),
      },
    });
    return { mode: "APPLIED" as const, planSha256, accounts };
  });
}
