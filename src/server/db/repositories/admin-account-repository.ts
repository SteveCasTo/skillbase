import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AdminAccountRepository } from "@/application/admin-accounts/repository";
import {
  AdminAccountError,
  applicableAdminAction,
  assertAdminAction,
} from "@/domain/admin-accounts/rules";
import type {
  AdminAccountDto,
  AdminAccountResult,
} from "@/domain/admin-accounts/types";
import * as s from "@/server/db/schema";
import type {
  AttendanceDatabase,
  AttendanceTransaction,
} from "./attendance-calendar";
import { lockInstructorSchedules } from "./instructor-schedule";
import { hasAdminActorActivity } from "./admin-account-dependencies";
type User = typeof s.users.$inferSelect;
const nextRevision = (previous: Date) =>
  new Date(Math.max(Date.now(), previous.getTime() + 1));
function fresh(actual: Date, expected: Date) {
  if (actual.getTime() !== expected.getTime())
    throw new AdminAccountError(
      "CONCURRENT_UPDATE",
      "La cuenta cambió. Recarga antes de continuar.",
    );
}
async function requireActor(tx: AttendanceTransaction, id: string) {
  const [actor] = await tx
    .select()
    .from(s.users)
    .where(eq(s.users.id, id))
    .for("share");
  const roles = await tx
    .select()
    .from(s.userRoles)
    .where(eq(s.userRoles.userId, id))
    .for("share");
  if (
    !actor ||
    actor.status !== "ACTIVE" ||
    !roles.some((r) => r.roleCode === "ADMIN")
  )
    throw new AdminAccountError(
      "FORBIDDEN",
      "La cuenta no tiene autorización vigente.",
    );
  return actor;
}
async function inspect(
  tx: AttendanceTransaction,
  user: User,
): Promise<AdminAccountDto> {
  const roles = await tx
    .select()
    .from(s.userRoles)
    .where(eq(s.userRoles.userId, user.id));
  const [deletion] = await tx
    .select()
    .from(s.adminAccountDeletions)
    .where(eq(s.adminAccountDeletions.userId, user.id));
  const state = {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    revision: user.updatedAt.toISOString(),
    exclusiveAdmin: roles.length === 1 && roles[0]?.roleCode === "ADMIN",
    hasActivity: await hasAdminActorActivity(tx, user.id),
    deletionPending: Boolean(deletion && !deletion.completedAt),
  };
  return { ...state, action: applicableAdminAction(state) };
}
/** Schedule barrier first, then ADMIN barrier, then sorted exclusive user rows.
 * FOR UPDATE conflicts with every existing business actor FOR SHARE and FK KEY SHARE.
 * No provider network request is made while these locks are held. */
async function lock(tx: AttendanceTransaction, actorId: string, id?: string) {
  await lockInstructorSchedules(tx);
  await tx.execute(sql`select pg_advisory_xact_lock(20261007, 8)`);
  const rows = await tx
    .select()
    .from(s.users)
    .where(
      inArray(s.users.id, [...new Set([actorId, ...(id ? [id] : [])])].sort()),
    )
    .orderBy(asc(s.users.id))
    .for("update");
  return rows;
}
async function lastAdmin(tx: AttendanceTransaction, removingActive = true) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(s.users)
    .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
    .where(
      and(eq(s.users.status, "ACTIVE"), eq(s.userRoles.roleCode, "ADMIN")),
    );
  if (!row || row.count < (removingActive ? 2 : 1))
    throw new AdminAccountError(
      "LAST_ACTIVE_ADMIN",
      "Debe permanecer al menos un administrador activo.",
    );
}
async function result(
  tx: AttendanceTransaction,
  actorId: string,
  user: User,
): Promise<AdminAccountResult> {
  const [actor] = await tx
    .select({ status: s.users.status })
    .from(s.users)
    .where(eq(s.users.id, actorId));
  return {
    account: await inspect(tx, user),
    deleted: false,
    actorActive: actor?.status === "ACTIVE",
  };
}
export class DrizzleAdminAccountRepository implements AdminAccountRepository {
  constructor(private readonly db: AttendanceDatabase) {}
  authorize(actorId: string) {
    return this.db.transaction(async (tx) => {
      await requireActor(tx, actorId);
    });
  }
  list(actorId: string) {
    return this.db.transaction(async (tx) => {
      await requireActor(tx, actorId);
      const rows = await tx
        .select({ user: s.users })
        .from(s.users)
        .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
        .where(eq(s.userRoles.roleCode, "ADMIN"))
        .orderBy(asc(s.users.name), asc(s.users.id));
      return Promise.all(rows.map((r) => inspect(tx, r.user)));
    });
  }
  get(actorId: string, id: string) {
    return this.db.transaction(async (tx) => {
      await requireActor(tx, actorId);
      const [row] = await tx
        .select({ user: s.users })
        .from(s.users)
        .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
        .where(and(eq(s.users.id, id), eq(s.userRoles.roleCode, "ADMIN")));
      return row ? inspect(tx, row.user) : null;
    });
  }
  emailExists(actorId: string, email: string) {
    return this.db.transaction(async (tx) => {
      await requireActor(tx, actorId);
      const rows = await tx
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, email))
        .limit(1);
      return rows.length > 0;
    });
  }
  create(
    actorId: string,
    input: { name: string; email: string; authUserId: string },
  ) {
    return this.db.transaction(async (tx) => {
      await lock(tx, actorId);
      await requireActor(tx, actorId);
      const [existing] = await tx
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, input.email));
      if (existing)
        throw new AdminAccountError(
          "EMAIL_EXISTS",
          "Ya existe una cuenta con ese correo.",
          { email: "El correo ya está registrado." },
        );
      const [user] = await tx
        .insert(s.users)
        .values({
          ...input,
          status: "ACTIVE",
          authPrimaryProvider: "EMAIL",
          updatedAt: new Date(),
        })
        .returning();
      if (!user) throw new Error("Account creation failed");
      await tx
        .insert(s.userRoles)
        .values({ userId: user.id, roleCode: "ADMIN" });
      await tx.insert(s.auditEvents).values({
        actorId,
        entityType: "USER",
        entityId: user.id,
        action: "ADMIN_ACCOUNT_CREATED",
      });
      return inspect(tx, user);
    });
  }
  rename(actorId: string, id: string, name: string, revision: Date) {
    return this.db.transaction(async (tx) => {
      const rows = await lock(tx, actorId, id);
      await requireActor(tx, actorId);
      const user = rows.find((r) => r.id === id);
      if (!user)
        throw new AdminAccountError("NOT_FOUND", "La cuenta no existe.");
      const state = await inspect(tx, user);
      if (!state.exclusiveAdmin)
        throw new AdminAccountError(
          "ROLE_NOT_EXCLUSIVE",
          "La cuenta multirol conserva su editor profesional.",
        );
      if (state.deletionPending || user.status === "INVITED")
        throw new AdminAccountError(
          "INVALID_STATE",
          "La cuenta no se puede editar.",
        );
      fresh(user.updatedAt, revision);
      const [updated] = await tx
        .update(s.users)
        .set({ name, updatedAt: nextRevision(user.updatedAt) })
        .where(eq(s.users.id, id))
        .returning();
      await tx.insert(s.auditEvents).values({
        actorId,
        entityType: "USER",
        entityId: id,
        action: "USER_PROFILE_UPDATED",
        metadata: { fields: "name" },
      });
      return result(tx, actorId, updated!);
    });
  }
  setActive(
    actorId: string,
    id: string,
    action: "activate" | "deactivate",
    revision: Date,
  ) {
    return this.db.transaction(async (tx) => {
      const rows = await lock(tx, actorId, id);
      await requireActor(tx, actorId);
      const user = rows.find((r) => r.id === id);
      if (!user)
        throw new AdminAccountError("NOT_FOUND", "La cuenta no existe.");
      fresh(user.updatedAt, revision);
      assertAdminAction(await inspect(tx, user), action);
      if (action === "deactivate") await lastAdmin(tx);
      const [updated] = await tx
        .update(s.users)
        .set({
          status: action === "activate" ? "ACTIVE" : "DISABLED",
          updatedAt: nextRevision(user.updatedAt),
        })
        .where(eq(s.users.id, id))
        .returning();
      await tx.insert(s.auditEvents).values({
        actorId,
        entityType: "USER",
        entityId: id,
        action:
          action === "activate"
            ? "ADMIN_ACCOUNT_ACTIVATED"
            : "ADMIN_ACCOUNT_DEACTIVATED",
      });
      return result(tx, actorId, updated!);
    });
  }
  beginDeletion(
    actorId: string,
    id: string,
    action: "delete" | "retry-delete",
    revision: Date,
  ) {
    return this.db.transaction(async (tx) => {
      const rows = await lock(tx, actorId, id);
      await requireActor(tx, actorId);
      const user = rows.find((r) => r.id === id);
      if (!user)
        throw new AdminAccountError("NOT_FOUND", "La cuenta no existe.");
      const [intent] = await tx
        .select()
        .from(s.adminAccountDeletions)
        .where(eq(s.adminAccountDeletions.userId, id));
      if (intent) {
        await lastAdmin(tx, false);
        if (!intent.completedAt && !(await inspect(tx, user)).exclusiveAdmin)
          throw new AdminAccountError(
            "ROLE_NOT_EXCLUSIVE",
            "La cuenta multirol debe conservar su perfil y permisos profesionales.",
          );
        // Only the originally observed request or the current pending revision replays.
        if (revision.getTime() !== intent.requestedRevision.getTime())
          fresh(user.updatedAt, revision);
        if (user.status !== "DISABLED" || user.authUserId !== intent.authUserId)
          throw new AdminAccountError(
            "INVALID_STATE",
            "La intención de eliminación no corresponde a la cuenta.",
          );
        return {
          authUserId: intent.authUserId,
          completed: Boolean(intent.completedAt),
          actorActive: true,
        };
      }
      fresh(user.updatedAt, revision);
      assertAdminAction(await inspect(tx, user), action);
      // Guard even when target was already disabled: a lifecycle operation cannot proceed with zero admins.
      await lastAdmin(tx, user.status === "ACTIVE");
      if (!user.authUserId)
        throw new AdminAccountError(
          "INVALID_STATE",
          "La cuenta no tiene identidad de acceso.",
        );
      await tx
        .update(s.users)
        .set({ status: "DISABLED", updatedAt: nextRevision(user.updatedAt) })
        .where(eq(s.users.id, id));
      await tx.insert(s.adminAccountDeletions).values({
        userId: id,
        actorId,
        authUserId: user.authUserId,
        requestedRevision: revision,
      });
      await tx.insert(s.auditEvents).values({
        actorId,
        entityType: "USER",
        entityId: id,
        action: "ADMIN_ACCOUNT_DELETION_REQUESTED",
      });
      return {
        authUserId: user.authUserId,
        completed: false,
        actorActive: actorId !== id,
      };
    });
  }
  completeDeletion(actorId: string, id: string, authUserId: string) {
    return this.db.transaction(async (tx) => {
      const rows = await lock(tx, actorId, id);
      const [intent] = await tx
        .select()
        .from(s.adminAccountDeletions)
        .where(eq(s.adminAccountDeletions.userId, id));
      const user = rows.find((r) => r.id === id);
      if (
        !intent ||
        !user ||
        intent.authUserId !== authUserId ||
        user.authUserId !== authUserId ||
        user.status !== "DISABLED"
      )
        throw new AdminAccountError(
          "INVALID_STATE",
          "La eliminación no está pendiente.",
        );
      // Narrow self-completion exception: request was authorized while active, intent is immutable.
      if (actorId !== id) await requireActor(tx, actorId);
      else if (intent.actorId !== actorId)
        throw new AdminAccountError(
          "FORBIDDEN",
          "La cuenta no tiene autorización vigente.",
        );
      await lastAdmin(tx, false);
      if (!intent.completedAt) {
        const state = await inspect(tx, user);
        if (!state.exclusiveAdmin)
          throw new AdminAccountError(
            "ROLE_NOT_EXCLUSIVE",
            "La cuenta multirol debe conservar sus permisos profesionales.",
          );
      }
      if (!intent.completedAt) {
        await tx.delete(s.userRoles).where(eq(s.userRoles.userId, id));
        await tx
          .update(s.users)
          .set({
            email: `deleted-${id}@tombstone.invalid`,
            name: "Administrador eliminado",
            approvedGoogleIdentityId: null,
            updatedAt: nextRevision(user.updatedAt),
          })
          .where(eq(s.users.id, id));
        await tx
          .update(s.adminAccountDeletions)
          .set({ completedAt: new Date() })
          .where(eq(s.adminAccountDeletions.userId, id));
        await tx.insert(s.auditEvents).values({
          actorId,
          entityType: "USER",
          entityId: id,
          action: "ADMIN_ACCOUNT_DELETED",
        });
      }
      return { account: null, deleted: true, actorActive: actorId !== id };
    });
  }
}
