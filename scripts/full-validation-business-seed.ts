import { eq, sql } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InternalUser } from "@/domain/auth/types";
import { resolveActiveUser, requireRoles } from "@/application/auth/authorize";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import type { RegistrationDatabase } from "@/server/db/repositories/registration-support";
import * as s from "@/server/db/schema";
import { lockInstructorSchedules } from "@/server/db/repositories/instructor-schedule";
import { createBusinessFixtures, preflight } from "./comprehensive-demo";
import {
  FULL_VALIDATION_OWNER,
  fullValidationBusinessPlan,
} from "./full-validation-seed-matrix";
import {
  fullValidationPlanHash,
  FULL_VALIDATION_BUSINESS_TABLES,
} from "./full-validation-reset-plan";
import {
  assertApprovedDemoMigrationLedger,
  type DemoMigrationLedgerRow,
} from "./approved-demo-migration-ledger";

export interface FullValidationAccounts {
  readonly instructors: readonly string[];
  readonly operatorId: string;
}

async function existingValidationActor(
  db: RegistrationDatabase,
  auth: SupabaseClient,
  actorId: string,
): Promise<InternalUser> {
  const [user] = await db.select().from(s.users).where(eq(s.users.id, actorId));
  if (!user?.authUserId) throw new Error("Existing linked actor required");
  const identity = await auth.auth.admin.getUserById(user.authUserId);
  if (
    identity.error ||
    !identity.data.user ||
    identity.data.user.id !== user.authUserId
  )
    throw new Error("Existing Auth identity could not be verified");
  const actor = await resolveActiveUser(
    new DrizzleAuthUserRepository(db),
    user.authUserId,
  );
  requireRoles(actor, ["ADMIN"]);
  return actor;
}

async function verifyAccounts(
  db: RegistrationDatabase,
  accounts: FullValidationAccounts,
) {
  if (
    accounts.instructors.length !== 4 ||
    new Set(accounts.instructors).size !== 4
  )
    throw new Error("Exactly four reviewed retained instructors required");
  for (const id of accounts.instructors) {
    const [user] = await db.select().from(s.users).where(eq(s.users.id, id));
    const [profile] = await db
      .select()
      .from(s.instructorProfiles)
      .where(eq(s.instructorProfiles.id, id));
    const roles = await db
      .select()
      .from(s.userRoles)
      .where(eq(s.userRoles.userId, id));
    const [outbox] = await db
      .select()
      .from(s.instructorAccountDeletions)
      .where(eq(s.instructorAccountDeletions.userId, id));
    if (
      !user ||
      !profile ||
      !user.authUserId ||
      user.status !== "ACTIVE" ||
      roles.length !== 1 ||
      roles[0]?.roleCode !== "INSTRUCTOR" ||
      (outbox && !outbox.completedAt) ||
      /demo|fictici|ejemplo/iu.test(
        `${user.name} ${profile.firstName} ${profile.lastName}`,
      )
    )
      throw new Error("Reviewed active natural instructor profile unavailable");
  }
}

/** Fresh business recreation, never a reset. Existing Auth/roles/outboxes remain
 * untouched. The already approved reset receipt and source-complete migration
 * ledger are mandatory, and natural profiles must be prepared through their
 * actual services BEFORE new immutable official reports are created. */
export async function seedFullValidationBusiness(
  db: RegistrationDatabase,
  auth: SupabaseClient,
  options: {
    actorId: string;
    operationId: string;
    anchorDay: string;
    accounts: FullValidationAccounts;
    apply: boolean;
    reviewedPlanSha256?: string;
  },
) {
  const actor = await existingValidationActor(db, auth, options.actorId);
  const operator = await existingValidationActor(
    db,
    auth,
    options.accounts.operatorId,
  );
  if (operator.email !== "comprehensive.v1.operator@example.test")
    throw new Error(
      "Reviewed retained synthetic operator required; never adopt primary ADMIN into fixture lifecycle",
    );
  if (/demo|fictici|ejemplo/iu.test(`${actor.name} ${operator.name}`))
    throw new Error(
      "Prepare approved natural ADMIN names before recreating snapshots",
    );
  await verifyAccounts(db, options.accounts);
  const [attendance] = await db
    .select()
    .from(s.attendanceSettings)
    .where(eq(s.attendanceSettings.id, 1));
  const [registration] = await db
    .select()
    .from(s.registrationSettings)
    .where(eq(s.registrationSettings.id, 1));
  if (!attendance || !registration)
    throw new Error("Reviewed global settings required");
  const businessPlan = fullValidationBusinessPlan(
    options.anchorDay,
    attendance.consecutiveAbsenceLimit,
    registration.minimumPaymentPercent,
  );
  const reviewed = {
    owner: FULL_VALIDATION_OWNER,
    anchorDay: options.anchorDay,
    operationId: options.operationId,
    actorId: actor.id,
    accounts: options.accounts,
    settings: { attendance, registration },
    businessPlan,
  };
  const planSha256 = fullValidationPlanHash(reviewed);
  if (options.reviewedPlanSha256 && options.reviewedPlanSha256 !== planSha256)
    throw new Error("Reviewed full validation seed plan changed");
  if (!options.apply)
    return { mode: "PLAN" as const, planSha256, plan: reviewed };
  if (!options.reviewedPlanSha256)
    throw new Error("Explicit reviewed seed hash required for APPLY");
  return db.transaction(async (tx) => {
    await lockInstructorSchedules(tx);
    await tx.execute(sql`select pg_advisory_xact_lock(20260915,1)`);
    const ledger = await tx.execute<DemoMigrationLedgerRow>(
      sql`select id,hash,created_at::text as "createdAt" from drizzle.__drizzle_migrations order by id`,
    );
    assertApprovedDemoMigrationLedger(ledger);
    const [reset] = await tx
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, options.operationId));
    if (
      !reset ||
      reset.action !== "VALIDATION_BUSINESS_RESET" ||
      reset.actorId !== actor.id ||
      reset.metadata.owner !== FULL_VALIDATION_OWNER
    )
      throw new Error("Approved completed business reset receipt required");
    const [complete] = await tx
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, seedReceiptId(options.operationId)));
    if (complete) {
      if (
        complete.metadata.owner !== FULL_VALIDATION_OWNER ||
        complete.metadata.planSha256 !== planSha256
      )
        throw new Error("Existing validation seed receipt conflicts");
      return { mode: "NOOP" as const, planSha256 };
    }
    // Every referenced business relation must be empty. Audit contains ONLY
    // the reset marker until normal fixture services create their own events.
    for (const table of FULL_VALIDATION_BUSINESS_TABLES) {
      if (table === "audit_events") continue;
      const rows = await tx.execute<{ n: number }>(
        sql`select count(*)::integer as n from public.${sql.identifier(table)}`,
      );
      if (rows[0]?.n !== 0)
        throw new Error(
          "Business seed target is not empty; no adoption or extra reset",
        );
    }
    const audit = await tx.select().from(s.auditEvents);
    const permittedPreparation = new Set([
      "USER_PROFILE_UPDATED",
      "INSTRUCTOR_UPDATED",
      "CERTIFICATE_SETTINGS_UPDATED",
      "VALIDATION_PREPARED",
    ]);
    if (
      audit.some(
        (event) =>
          event.id !== options.operationId &&
          (event.actorId !== actor.id ||
            !permittedPreparation.has(event.action)),
      )
    )
      throw new Error("Unexpected application evidence before fresh seed");
    const actors = await tx.select({ name: s.users.name }).from(s.users);
    const profiles = await tx
      .select({
        firstName: s.instructorProfiles.firstName,
        lastName: s.instructorProfiles.lastName,
      })
      .from(s.instructorProfiles);
    if (
      actors.some((user) => /demo|fictici|ejemplo/iu.test(user.name)) ||
      profiles.some((profile) =>
        /demo|fictici|ejemplo/iu.test(
          `${profile.firstName} ${profile.lastName}`,
        ),
      )
    )
      throw new Error(
        "Remaining old account/profile display names require their reviewed ordinary service edits",
      );
    const [freshAttendance] = await tx
      .select()
      .from(s.attendanceSettings)
      .where(eq(s.attendanceSettings.id, 1))
      .for("share");
    const [freshRegistration] = await tx
      .select()
      .from(s.registrationSettings)
      .where(eq(s.registrationSettings.id, 1))
      .for("share");
    if (
      fullValidationPlanHash({
        attendance: freshAttendance,
        registration: freshRegistration,
      }) !== fullValidationPlanHash({ attendance, registration })
    )
      throw new Error("Global settings changed after reviewed seed plan");
    await preflight(tx, businessPlan);
    const context = await createBusinessFixtures(
      tx,
      actor,
      businessPlan,
      {
        instructors: [...options.accounts.instructors],
        admins: { operator: operator.id },
      },
      false,
    );
    await tx.insert(s.auditEvents).values({
      id: seedReceiptId(options.operationId),
      actorId: actor.id,
      entityType: "BUSINESS_MAINTENANCE",
      entityId: options.operationId,
      action: "VALIDATION_BUSINESS_SEEDED",
      metadata: {
        owner: FULL_VALIDATION_OWNER,
        planSha256,
        anchorDay: options.anchorDay,
        context: JSON.stringify(context),
        contextSha256: fullValidationPlanHash(context),
      },
    });
    return { mode: "APPLIED" as const, planSha256, context };
  });
}

function seedReceiptId(operationId: string): string {
  const hash = fullValidationPlanHash({
    owner: FULL_VALIDATION_OWNER,
    operationId,
    purpose: "business-seeded",
  });
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
