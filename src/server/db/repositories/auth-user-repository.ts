import { createHash } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type {
  AuthUserRepository,
  PreprovisionUserInput,
} from "@/application/auth/user-repository";
import { AuthorizationError } from "@/domain/auth/errors";
import { normalizeEmail } from "@/domain/auth/policies";
import type {
  AuthRole,
  InternalUser,
  VerifiedIdentity,
} from "@/domain/auth/types";
import { AUTH_ROLES } from "@/domain/auth/types";
import * as schema from "@/server/db/schema";
import {
  validateInstructor,
  type InstructorProfileData,
} from "@/domain/instructors/profile";

type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function lockActiveIdentity(tx: Transaction, id: string) {
  const [actor] = await tx
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .for("share");
  const roles = await tx
    .select()
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, id))
    .for("share");
  if (!actor || actor.status !== "ACTIVE" || !roles.length)
    throw new AuthorizationError("FORBIDDEN", "Account is not active");
}

function isRole(value: string): value is AuthRole {
  return value === "ADMIN" || value === "INSTRUCTOR";
}

async function hydrateUser(
  db: Database,
  userId: string,
): Promise<InternalUser | null> {
  const rows = await db
    .select({ user: schema.users, role: schema.userRoles.roleCode })
    .from(schema.users)
    .leftJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
    .where(eq(schema.users.id, userId));
  const first = rows[0]?.user;
  if (!first) return null;
  const roles = rows
    .flatMap(({ role }) => (role && isRole(role) ? [role] : []))
    .sort(
      (left, right) => AUTH_ROLES.indexOf(left) - AUTH_ROLES.indexOf(right),
    );
  return { ...first, roles };
}

export class DrizzleAuthUserRepository implements AuthUserRepository {
  constructor(private readonly db: Database) {}

  async recordPasswordChanged(actorId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockActiveIdentity(tx, actorId);
      await tx.insert(schema.auditEvents).values({
        actorId,
        entityType: "USER",
        entityId: actorId,
        action: "PASSWORD_CHANGED",
      });
    });
  }

  async createGoogleLinkRequest(
    nonce: string,
    internalUserId: string,
    sessionId: string,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .delete(schema.authGoogleLinkRequests)
      .where(lt(schema.authGoogleLinkRequests.expiresAt, now));
    await this.db.transaction(async (tx) => {
      await lockActiveIdentity(tx, internalUserId);
      await tx.insert(schema.authGoogleLinkRequests).values({
        nonceHash: createHash("sha256").update(nonce).digest("hex"),
        userId: internalUserId,
        sessionId,
        expiresAt: new Date(now.getTime() + 300_000),
      });
    });
  }

  async consumeGoogleLinkRequest(
    nonce: string,
    internalUserId: string,
    sessionId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .delete(schema.authGoogleLinkRequests)
      .where(
        and(
          eq(
            schema.authGoogleLinkRequests.nonceHash,
            createHash("sha256").update(nonce).digest("hex"),
          ),
          eq(schema.authGoogleLinkRequests.userId, internalUserId),
          eq(schema.authGoogleLinkRequests.sessionId, sessionId),
          gt(schema.authGoogleLinkRequests.expiresAt, new Date()),
        ),
      )
      .returning({ nonceHash: schema.authGoogleLinkRequests.nonceHash });
    return rows.length === 1;
  }

  async createPasswordInstructor(input: {
    email: string;
    name: string;
    authUserId: string;
    profile?: InstructorProfileData;
    actorId?: string;
  }): Promise<InternalUser> {
    return this.db.transaction(async (tx) => {
      if (input.profile) {
        if (!input.actorId) throw new Error("Provisioning actor missing");
        const [actor] = await tx
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, input.actorId))
          .for("update");
        const [role] = await tx
          .select()
          .from(schema.userRoles)
          .where(
            and(
              eq(schema.userRoles.userId, input.actorId),
              eq(schema.userRoles.roleCode, "ADMIN"),
            ),
          );
        if (actor?.status !== "ACTIVE" || !role)
          throw new AuthorizationError(
            "FORBIDDEN",
            "Provisioning is forbidden",
          );
      }
      const [user] = await tx
        .insert(schema.users)
        .values({
          email: normalizeEmail(input.email),
          name: input.name.trim(),
          authUserId: input.authUserId,
          status: "ACTIVE",
          authPrimaryProvider: "EMAIL",
        })
        .returning();
      if (!user) throw new Error("Account was not created");
      await tx
        .insert(schema.userRoles)
        .values({ userId: user.id, roleCode: "INSTRUCTOR" });
      if (input.profile) {
        const profile = validateInstructor({
          ...input.profile,
          phone: input.profile.phone ?? "",
          email: input.email,
        });
        await tx.insert(schema.instructorProfiles).values({
          id: user.id,
          firstName: profile.firstName,
          lastName: profile.lastName,
          phone: profile.phone,
        });
        if (!input.actorId) throw new Error("Provisioning actor missing");
        await tx.insert(schema.auditEvents).values({
          actorId: input.actorId,
          entityType: "INSTRUCTOR",
          entityId: user.id,
          action: "INSTRUCTOR_CREATED",
        });
      }
      const result = await hydrateUser(tx, user.id);
      if (!result) throw new Error("Account was not created");
      return result;
    });
  }

  async approveGoogleIdentity(
    authUserId: string,
    identityId: string,
  ): Promise<void> {
    const user = await this.findByAuthUserId(authUserId);
    if (!user || user.status !== "ACTIVE" || user.roles.length === 0)
      throw new AuthorizationError("FORBIDDEN", "Account is not active");
    await this.db
      .update(schema.users)
      .set({ approvedGoogleIdentityId: identityId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.users.authUserId, authUserId),
          eq(schema.users.status, "ACTIVE"),
        ),
      );
  }

  async findByAuthUserId(authUserId: string): Promise<InternalUser | null> {
    const [row] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.authUserId, authUserId))
      .limit(1);
    return row ? hydrateUser(this.db, row.id) : null;
  }

  async linkVerifiedInvitation(
    identity: VerifiedIdentity,
  ): Promise<InternalUser> {
    const email = normalizeEmail(identity.email);
    return this.db.transaction(async (tx) => {
      const [invitation] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1)
        .for("update");
      if (!invitation)
        throw new AuthorizationError("NOT_INVITED", "No matching invitation");
      if (invitation.status === "DISABLED")
        throw new AuthorizationError("DISABLED", "User is disabled");
      if (identity.provider !== "google" && invitation.status === "INVITED")
        throw new AuthorizationError(
          "FORBIDDEN",
          "Only Google can claim a legacy invitation",
        );
      if (
        invitation.authUserId !== null &&
        invitation.authUserId !== identity.authUserId
      )
        throw new AuthorizationError(
          "IDENTITY_CONFLICT",
          "Invitation is linked to another identity",
        );

      if (invitation.status === "INVITED") {
        await tx
          .update(schema.users)
          .set({
            authUserId: identity.authUserId,
            status: "ACTIVE",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.users.id, invitation.id),
              eq(schema.users.status, "INVITED"),
            ),
          );
      }
      const linked = await hydrateUser(tx, invitation.id);
      if (!linked) throw new Error("Linked user could not be loaded");
      if (linked.roles.length === 0)
        throw new AuthorizationError("NO_ROLES", "Invitation has no roles");
      return linked;
    });
  }

  async preprovision(input: PreprovisionUserInput): Promise<InternalUser> {
    const email = normalizeEmail(input.email);
    const roles = AUTH_ROLES.filter((role) => input.roles.includes(role));
    if (roles.length === 0) throw new Error("At least one role is required");
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1)
        .for("update");
      if (
        existing &&
        (existing.status !== "INVITED" || existing.authUserId !== null)
      )
        throw new AuthorizationError(
          "INVITATION_NOT_EDITABLE",
          "Only unlinked invitations can be preprovisioned",
        );
      const [user] = existing
        ? await tx
            .update(schema.users)
            .set({ name: input.name.trim(), updatedAt: new Date() })
            .where(eq(schema.users.id, existing.id))
            .returning()
        : await tx
            .insert(schema.users)
            .values({ email, name: input.name.trim() })
            .returning();
      if (!user) throw new Error("Preprovisioned user was not returned");
      await tx
        .delete(schema.userRoles)
        .where(eq(schema.userRoles.userId, user.id));
      await tx
        .insert(schema.userRoles)
        .values(roles.map((roleCode) => ({ userId: user.id, roleCode })));
      const result = await hydrateUser(tx, user.id);
      if (!result) throw new Error("Preprovisioned user could not be loaded");
      return result;
    });
  }
}
