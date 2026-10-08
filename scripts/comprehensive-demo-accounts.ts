import type { SupabaseClient, User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import type { InternalUser } from "@/domain/auth/types";
import { requirePassword } from "@/domain/auth/identity";
import { provisionPasswordInstructor } from "@/application/auth/provision-password-user";
import { resolveActiveUser } from "@/application/auth/authorize";
import {
  createAdminAccount,
  mutateAdminAccount,
  renameAdminAccount,
} from "@/application/admin-accounts/manage-admin-accounts";
import type { AdminCredentialGateway } from "@/application/admin-accounts/repository";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { DrizzleAdminAccountRepository } from "@/server/db/repositories/admin-account-repository";
import type { RegistrationDatabase } from "@/server/db/repositories/registration-support";
import * as s from "@/server/db/schema";
import {
  COMPREHENSIVE_DEMO_OWNER,
  comprehensiveDemoId,
} from "./comprehensive-demo-plan";

const definitions = [
  ...Array.from({ length: 4 }, (_, i) => ({
    key: `instructor-${i}`,
    name: `[DEMO] Docente ${i + 1}`,
    role: "INSTRUCTOR" as const,
  })),
  ...["operator", "unused", "disabled", "reactivated", "deleted"].map(
    (key) => ({ key, name: `[DEMO] ADMIN ${key}`, role: "ADMIN" as const }),
  ),
];
const emailFor = (key: string) => `comprehensive.v1.${key}@example.test`;

async function ownedIdentities(auth: SupabaseClient): Promise<User[]> {
  const identities: User[] = [];
  for (let page = 1; ; page++) {
    const result = await auth.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw new Error("Auth inspection unavailable");
    identities.push(...result.data.users);
    if (result.data.users.length < 100) return identities;
  }
}

/** Auth lives outside the business-data transaction. Ownership is server metadata,
 * not email alone. An interrupted provision recovers the same owned UUID without
 * changing its password. Original accounts are never renamed, disabled or deleted. */
export async function provisionComprehensiveAccounts(
  db: RegistrationDatabase,
  auth: SupabaseClient,
  actor: InternalUser,
  password: string,
  apply: boolean,
) {
  if (apply) requirePassword(password);
  const identities = await ownedIdentities(auth);
  const authRepo = new DrizzleAuthUserRepository(db);
  const adminRepo = new DrizzleAdminAccountRepository(db);
  await adminRepo.authorize(actor.id);
  const ids = new Map<string, string>();
  const existingIdentities = new Map<string, User>();
  // Preflight every account before the first Auth write.
  for (const definition of definitions) {
    const email = emailFor(definition.key);
    const identity = identities.find((u) => u.email === email);
    let [internal] = await db
      .select()
      .from(s.users)
      .where(eq(s.users.email, email));
    const [createdMarker] = await db
      .select()
      .from(s.auditEvents)
      .where(
        eq(
          s.auditEvents.id,
          comprehensiveDemoId(`account-created:${definition.key}`),
        ),
      );
    if (createdMarker) {
      if (
        createdMarker.metadata.seedOwner !== COMPREHENSIVE_DEMO_OWNER ||
        createdMarker.actorId !== actor.id ||
        createdMarker.action !== "DEMO_SEEDED"
      )
        throw new Error("Account creation provenance collision");
      const [recorded] = await db
        .select()
        .from(s.users)
        .where(eq(s.users.id, createdMarker.entityId));
      if (!recorded || (internal && internal.id !== recorded.id))
        throw new Error("Account creation identity changed");
      internal = recorded;
    }
    const [marker] = await db
      .select()
      .from(s.auditEvents)
      .where(
        eq(s.auditEvents.id, comprehensiveDemoId(`account:${definition.key}`)),
      );
    if (
      marker &&
      (marker.action !== "DEMO_SEEDED" ||
        marker.metadata.seedOwner !== COMPREHENSIVE_DEMO_OWNER ||
        marker.actorId !== actor.id)
    )
      throw new Error("Account provenance collision");
    if (definition.key === "deleted" && marker) {
      const [tombstone] = await db
        .select()
        .from(s.users)
        .where(eq(s.users.id, marker.entityId));
      const [intent] = await db
        .select()
        .from(s.adminAccountDeletions)
        .where(eq(s.adminAccountDeletions.userId, marker.entityId));
      if (
        !tombstone ||
        !intent?.completedAt ||
        tombstone.status !== "DISABLED" ||
        tombstone.email !== `deleted-${tombstone.id}@tombstone.invalid` ||
        identity
      )
        throw new Error("Deleted demo account changed");
      ids.set(definition.key, tombstone.id);
      continue;
    }
    if (
      identity &&
      identity.app_metadata.seed_owner !== COMPREHENSIVE_DEMO_OWNER
    )
      throw new Error("Unowned Auth email collision");
    if (
      internal &&
      (!identity ||
        internal.authUserId !== identity.id ||
        internal.authPrimaryProvider !== "EMAIL")
    ) {
      // A pending deletion may already have removed its owned Auth identity.
      const [intent] = await db
        .select()
        .from(s.adminAccountDeletions)
        .where(eq(s.adminAccountDeletions.userId, internal.id));
      if (
        definition.key !== "deleted" ||
        !createdMarker ||
        !intent ||
        intent.actorId !== actor.id ||
        intent.authUserId !== internal.authUserId ||
        internal.status !== "DISABLED"
      )
        throw new Error("Unowned internal account collision");
    }
    if (marker && (!internal || marker.entityId !== internal.id))
      throw new Error("Owned account missing; not recreated");
    if (internal) {
      const roles = await db
        .select()
        .from(s.userRoles)
        .where(eq(s.userRoles.userId, internal.id));
      const [intent] = await db
        .select()
        .from(s.adminAccountDeletions)
        .where(eq(s.adminAccountDeletions.userId, internal.id));
      if (
        !(definition.key === "deleted" && intent?.completedAt) &&
        (roles.length !== 1 || roles[0]?.roleCode !== definition.role)
      )
        throw new Error("Demo account role changed");
      if (definition.role === "INSTRUCTOR") {
        const [profile] = await db
          .select()
          .from(s.instructorProfiles)
          .where(eq(s.instructorProfiles.id, internal.id));
        if (!profile || internal.status !== "ACTIVE")
          throw new Error("Demo instructor unavailable");
      }
      ids.set(definition.key, internal.id);
    }
    if (identity) existingIdentities.set(definition.key, identity);
  }
  if (!apply)
    return {
      instructors: definitions
        .filter((d) => d.role === "INSTRUCTOR")
        .map(
          (d) =>
            ids.get(d.key) ?? comprehensiveDemoId(`planned-account:${d.key}`),
        ),
      admins: Object.fromEntries(
        definitions
          .filter((d) => d.role === "ADMIN")
          .map((d) => [
            d.key,
            ids.get(d.key) ?? comprehensiveDemoId(`planned-account:${d.key}`),
          ]),
      ),
    };

  for (const definition of definitions) {
    const email = emailFor(definition.key);
    const recovered = existingIdentities.get(definition.key);
    const created = new Set<string>();
    const removeOwned = async (id: string) => {
      const current = await auth.auth.admin.getUserById(id);
      if (current.error?.code === "user_not_found") return;
      if (
        current.error ||
        current.data.user?.email !== email ||
        current.data.user.app_metadata.seed_owner !== COMPREHENSIVE_DEMO_OWNER
      )
        throw new Error("Owned deletion identity required");
      const result = await auth.auth.admin.deleteUser(id);
      if (result.error && result.error.code !== "user_not_found")
        throw new Error("Auth deletion unavailable");
    };
    const gateway: AdminCredentialGateway = {
      async createConfirmedUser(mail, credential) {
        if (mail !== email) throw new Error("Unexpected demo email");
        if (recovered) return recovered.id;
        const result = await auth.auth.admin.createUser({
          email: mail,
          password: credential,
          email_confirm: true,
          app_metadata: { seed_owner: COMPREHENSIVE_DEMO_OWNER },
        });
        if (result.error || !result.data.user) return null;
        created.add(result.data.user.id);
        return result.data.user.id;
      },
      async removeCreatedUser(id) {
        if (created.has(id)) await removeOwned(id);
      },
      deleteUser: removeOwned,
    };
    if (!ids.has(definition.key)) {
      if (definition.role === "INSTRUCTOR") {
        const user = await provisionPasswordInstructor(
          authRepo,
          gateway,
          actor.authUserId!,
          {
            email,
            name: definition.name,
            password,
            profile: {
              firstName: "Docente",
              lastName: `Demo ${definition.key.slice(-1)}`,
              phone: null,
            },
          },
        );
        ids.set(definition.key, user.id);
      } else {
        const result = await createAdminAccount(adminRepo, gateway, actor, {
          email,
          name: definition.name,
          password,
        });
        if (!result.account) throw new Error("Demo ADMIN creation failed");
        ids.set(definition.key, result.account.id);
      }
    }
    const id = ids.get(definition.key)!;
    const markerId = comprehensiveDemoId(`account:${definition.key}`);
    const [marker] = await db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, markerId));
    if (marker) continue; // Preserve edits and lifecycle changes after the initial fixture.
    if (definition.key === "deleted") {
      const creationMarkerId = comprehensiveDemoId(
        `account-created:${definition.key}`,
      );
      const [creation] = await db
        .select()
        .from(s.auditEvents)
        .where(eq(s.auditEvents.id, creationMarkerId));
      if (!creation)
        await db.insert(s.auditEvents).values({
          id: creationMarkerId,
          actorId: actor.id,
          entityType: "USER",
          entityId: id,
          action: "DEMO_SEEDED",
          metadata: { seedOwner: COMPREHENSIVE_DEMO_OWNER },
        });
      const [intent] = await db
        .select()
        .from(s.adminAccountDeletions)
        .where(eq(s.adminAccountDeletions.userId, id));
      const row = await adminRepo.get(actor.id, id);
      if (!intent?.completedAt) {
        if (!row) throw new Error("Pending demo deletion account missing");
        await mutateAdminAccount(
          adminRepo,
          gateway,
          actor,
          id,
          row.deletionPending ? "retry-delete" : "delete",
          row.revision,
        );
      }
      await db.insert(s.auditEvents).values({
        id: markerId,
        actorId: actor.id,
        entityType: "USER",
        entityId: id,
        action: "DEMO_SEEDED",
        metadata: {
          seedOwner: COMPREHENSIVE_DEMO_OWNER,
          scenario: definition.key,
        },
      });
      continue;
    }
    // Account lifecycle + completion marker share a transaction, so retry cannot
    // repeat rename/deactivation audits after an interruption.
    await db.transaction(async (tx) => {
      const repo = new DrizzleAdminAccountRepository(tx);
      if (["disabled", "reactivated"].includes(definition.key)) {
        const own = await resolveActiveUser(
          new DrizzleAuthUserRepository(tx),
          (existingIdentities.get(definition.key)?.id ??
            (await tx.select().from(s.users).where(eq(s.users.id, id)))[0]!
              .authUserId)!,
        );
        const row = await repo.get(actor.id, id);
        if (!row) throw new Error("Demo lifecycle account missing");
        const renamed = await renameAdminAccount(
          repo,
          own,
          id,
          `${definition.name} · con actividad`,
          row.revision,
        );
        const disabled = await mutateAdminAccount(
          repo,
          gateway,
          actor,
          id,
          "deactivate",
          renamed.account!.revision,
        );
        if (definition.key === "reactivated")
          await mutateAdminAccount(
            repo,
            gateway,
            actor,
            id,
            "activate",
            disabled.account!.revision,
          );
      }
      await tx.insert(s.auditEvents).values({
        id: markerId,
        actorId: actor.id,
        entityType: "USER",
        entityId: id,
        action: "DEMO_SEEDED",
        metadata: {
          seedOwner: COMPREHENSIVE_DEMO_OWNER,
          scenario: definition.key,
        },
      });
    });
  }
  return {
    instructors: definitions
      .filter((d) => d.role === "INSTRUCTOR")
      .map((d) => ids.get(d.key)!),
    admins: Object.fromEntries(
      definitions
        .filter((d) => d.role === "ADMIN")
        .map((d) => [d.key, ids.get(d.key)!]),
    ),
  };
}
