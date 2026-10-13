import { eq } from "drizzle-orm";
import { lockInstructorSchedules } from "@/server/db/repositories/instructor-schedule";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegistrationDatabase } from "@/server/db/repositories/registration-support";
import { resolveActiveUser, requireRoles } from "@/application/auth/authorize";
import { renameAdminAccount } from "@/application/admin-accounts/manage-admin-accounts";
import { updateInstructor } from "@/application/instructors/manage-instructors";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { DrizzleAdminAccountRepository } from "@/server/db/repositories/admin-account-repository";
import { DrizzleInstructorRepository } from "@/server/db/repositories/instructor-repository";
import { DrizzleCertificateRepository } from "@/server/db/repositories/certificate-repository";
import * as s from "@/server/db/schema";
import {
  FULL_VALIDATION_AUTHORITIES,
  FULL_VALIDATION_OWNER,
} from "./full-validation-seed-matrix";
import { fullValidationPlanHash } from "./full-validation-reset-plan";

export type ValidationNameEdit =
  | { type: "ADMIN"; id: string; name: string }
  | { type: "INSTRUCTOR"; id: string; firstName: string; lastName: string };

type PreparationChange =
  | {
      type: "ADMIN";
      id: string;
      before: string;
      after: string;
      revision: string;
    }
  | {
      type: "INSTRUCTOR";
      id: string;
      before: { firstName: string; lastName: string };
      after: { firstName: string; lastName: string };
      phone: string | null;
      revision: string;
    };

/** PLAN describes exact ordinary service changes; it never repairs a role,
 * credential, provider link, invitation or disabled account to make a fixture. */
export async function prepareFullValidationNamesAndSettings(
  db: RegistrationDatabase,
  auth: SupabaseClient,
  options: {
    actorId: string;
    operationId: string;
    nameEdits: readonly ValidationNameEdit[];
    apply: boolean;
    reviewedPlanSha256?: string;
  },
) {
  const [user] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, options.actorId));
  if (!user?.authUserId) throw new Error("Existing linked ADMIN required");
  const identity = await auth.auth.admin.getUserById(user.authUserId);
  if (identity.error || identity.data.user?.id !== user.authUserId)
    throw new Error("Existing ADMIN identity unavailable");
  const actor = await resolveActiveUser(
    new DrizzleAuthUserRepository(db),
    user.authUserId,
  );
  requireRoles(actor, ["ADMIN"]);
  const receiptId = preparationReceiptId(options.operationId);
  const [complete] = await db
    .select()
    .from(s.auditEvents)
    .where(eq(s.auditEvents.id, receiptId));
  if (complete) {
    if (
      complete.actorId !== actor.id ||
      complete.action !== "VALIDATION_PREPARED" ||
      complete.metadata.owner !== FULL_VALIDATION_OWNER ||
      complete.metadata.nameEditsSha256 !==
        fullValidationPlanHash(options.nameEdits) ||
      (options.reviewedPlanSha256 &&
        complete.metadata.planSha256 !== options.reviewedPlanSha256)
    )
      throw new Error(
        "Preparation receipt conflicts; do not adopt or overwrite profiles",
      );
    return {
      mode: "NOOP" as const,
      planSha256: String(complete.metadata.planSha256),
      nameChanges: 0,
      settingsChanged: false,
    };
  }
  const admins = new DrizzleAdminAccountRepository(db);
  const instructors = new DrizzleInstructorRepository(db);
  const certificates = new DrizzleCertificateRepository(db);
  const changes: PreparationChange[] = [];
  const seen = new Set<string>();
  for (const edit of options.nameEdits) {
    if (seen.has(edit.id)) throw new Error("Duplicate reviewed profile edit");
    seen.add(edit.id);
    if (edit.type === "ADMIN") {
      const record = await admins.get(actor.id, edit.id);
      if (!record) throw new Error("Reviewed ADMIN profile missing");
      if (/demo|fictici|ejemplo/iu.test(edit.name) || !edit.name.trim())
        throw new Error("Natural reviewed ADMIN display name required");
      if (record.name !== edit.name) {
        if (
          !/demo|fictici|ejemplo|sint[eé]tic|fixture|\bQA\b|\bprueba\b/iu.test(
            record.name,
          )
        )
          throw new Error(
            "Never overwrite an already natural primary profile without a separate plan",
          );
        changes.push({
          type: "ADMIN" as const,
          id: edit.id,
          before: record.name,
          after: edit.name,
          revision: record.revision,
        });
      }
    } else {
      const record = await instructors.get(edit.id);
      if (!record) throw new Error("Reviewed instructor profile missing");
      const after = `${edit.firstName} ${edit.lastName}`;
      if (
        /demo|fictici|ejemplo/iu.test(after) ||
        !edit.firstName.trim() ||
        !edit.lastName.trim()
      )
        throw new Error("Natural reviewed instructor components required");
      if (
        record.firstName !== edit.firstName ||
        record.lastName !== edit.lastName
      ) {
        if (
          !/demo|fictici|ejemplo|sint[eé]tic|fixture|\bQA\b|\bprueba\b/iu.test(
            `${record.firstName} ${record.lastName}`,
          )
        )
          throw new Error(
            "Never overwrite an already natural instructor without a separate plan",
          );
        changes.push({
          type: "INSTRUCTOR" as const,
          id: edit.id,
          before: { firstName: record.firstName, lastName: record.lastName },
          after: { firstName: edit.firstName, lastName: edit.lastName },
          phone: record.phone,
          revision: record.updatedAt.toISOString(),
        });
      }
    }
  }
  const current = await certificates.getSettings(actor.id);
  const configuration = {
    ...structuredClone(current.configuration),
    templateVersion: "phase9-v2",
    director: {
      ...current.configuration.director,
      name: FULL_VALIDATION_AUTHORITIES.director,
    },
    dean: {
      ...current.configuration.dean,
      name: FULL_VALIDATION_AUTHORITIES.dean,
    },
    departmentHead: {
      ...current.configuration.departmentHead,
      name: FULL_VALIDATION_AUTHORITIES.departmentHead,
      affiliation: "INFORMÁTICA Y SISTEMAS",
    },
  };
  if (configuration.brandingVersion !== "phase9-v1")
    throw new Error(
      "Unexpected institutional branding; do not silently replace it",
    );
  const settingChange =
    fullValidationPlanHash(configuration) !==
    fullValidationPlanHash(current.configuration);
  const plan = {
    owner: FULL_VALIDATION_OWNER,
    operationId: options.operationId,
    actorId: actor.id,
    changes,
    settings: settingChange
      ? {
          revision: current.revision,
          before: current.configuration,
          after: configuration,
        }
      : null,
  };
  const planSha256 = fullValidationPlanHash(plan);
  if (options.reviewedPlanSha256 && options.reviewedPlanSha256 !== planSha256)
    throw new Error("Reviewed profile/settings preparation changed");
  if (!options.apply) return { mode: "PLAN" as const, planSha256, plan };
  if (!options.reviewedPlanSha256)
    throw new Error("Explicit reviewed preparation hash required");
  return db.transaction(async (tx) => {
    await lockInstructorSchedules(tx);
    const [replayed] = await tx
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, receiptId));
    if (replayed) {
      if (
        replayed.actorId !== actor.id ||
        replayed.metadata.planSha256 !== planSha256
      )
        throw new Error("Concurrent preparation receipt conflicts");
      return {
        mode: "NOOP" as const,
        planSha256,
        nameChanges: 0,
        settingsChanged: false,
      };
    }
    for (const change of changes) {
      if (change.type === "ADMIN")
        await renameAdminAccount(
          new DrizzleAdminAccountRepository(tx),
          actor,
          change.id,
          change.after,
          change.revision,
        );
      else
        await updateInstructor(
          new DrizzleInstructorRepository(tx),
          actor,
          change.id,
          { ...change.after, phone: change.phone ?? "" },
          change.revision,
        );
    }
    if (settingChange)
      await new DrizzleCertificateRepository(tx).updateSettings(
        actor.id,
        current.revision,
        configuration,
      );
    await tx.insert(s.auditEvents).values({
      id: receiptId,
      actorId: actor.id,
      entityType: "BUSINESS_MAINTENANCE",
      entityId: options.operationId,
      action: "VALIDATION_PREPARED",
      metadata: {
        owner: FULL_VALIDATION_OWNER,
        planSha256,
        nameEditsSha256: fullValidationPlanHash(options.nameEdits),
      },
    });
    return {
      mode:
        changes.length || settingChange
          ? ("APPLIED" as const)
          : ("NOOP" as const),
      planSha256,
      nameChanges: changes.length,
      settingsChanged: settingChange,
    };
  });
}

function preparationReceiptId(operationId: string): string {
  const h = fullValidationPlanHash({
    owner: FULL_VALIDATION_OWNER,
    operationId,
    purpose: "prepared",
  });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
