import { and, eq } from "drizzle-orm";
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

type Database = PostgresJsDatabase<typeof schema>;

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
