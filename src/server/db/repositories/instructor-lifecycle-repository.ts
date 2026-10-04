import { and, asc, eq, ne } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { InstructorLifecycleRepository } from "@/application/instructors/lifecycle";
import {
  assertInstructorLifecycle,
  isExclusiveInstructor,
  type InstructorLifecycle,
} from "@/domain/instructors/lifecycle";
import { InstructorError } from "@/domain/instructors/profile";
import * as schema from "@/server/db/schema";
import { lockInstructorSchedules } from "./instructor-schedule";

type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function inspect(
  db: Database | Transaction,
  id: string,
): Promise<InstructorLifecycle> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id));
  if (!user) throw new InstructorError("El instructor no existe.");
  const roles = await db
    .select({ code: schema.userRoles.roleCode })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, id));
  const courses = await db
    .select({ id: schema.courses.id, name: schema.courses.name })
    .from(schema.courses)
    .where(
      and(
        eq(schema.courses.instructorId, id),
        ne(schema.courses.status, "ARCHIVED"),
      ),
    )
    .orderBy(asc(schema.courses.id));
  const [history] = await db
    .select({ id: schema.courseInstructorHistory.courseId })
    .from(schema.courseInstructorHistory)
    .where(eq(schema.courseInstructorHistory.instructorId, id))
    .limit(1);
  const [assignment] = await db
    .select({ id: schema.courses.id })
    .from(schema.courses)
    .where(eq(schema.courses.instructorId, id))
    .limit(1);
  const [actorEvent] = await db
    .select({ id: schema.auditEvents.id })
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.actorId, id))
    .limit(1);
  const [createdCourse] = await db
    .select({ id: schema.courses.id })
    .from(schema.courses)
    .where(eq(schema.courses.createActorId, id))
    .limit(1);
  const [actorHistory] = await db
    .select({ id: schema.courseInstructorHistory.courseId })
    .from(schema.courseInstructorHistory)
    .where(eq(schema.courseInstructorHistory.actorId, id))
    .limit(1);
  const [link] = await db
    .select({ id: schema.authGoogleLinkRequests.userId })
    .from(schema.authGoogleLinkRequests)
    .where(eq(schema.authGoogleLinkRequests.userId, id))
    .limit(1);
  const [otherDeletion] = await db
    .select({ id: schema.instructorAccountDeletions.userId })
    .from(schema.instructorAccountDeletions)
    .where(eq(schema.instructorAccountDeletions.actorId, id))
    .limit(1);
  const [deletion] = await db
    .select()
    .from(schema.instructorAccountDeletions)
    .where(eq(schema.instructorAccountDeletions.userId, id));
  return {
    status: user.status,
    exclusiveInstructor: isExclusiveInstructor(
      roles.map((r) => r.code as "ADMIN" | "INSTRUCTOR"),
    ),
    courses,
    assignedHistorically: Boolean(history || assignment),
    hasDependencies: Boolean(
      actorEvent || createdCourse || actorHistory || link || otherDeletion,
    ),
    deletionPending: Boolean(deletion),
  };
}

export class DrizzleInstructorLifecycleRepository implements InstructorLifecycleRepository {
  constructor(private readonly db: Database) {}
  inspect(id: string) {
    return inspect(this.db, id);
  }

  private async lock(tx: Transaction, id: string, actorId: string) {
    await lockInstructorSchedules(tx, undefined, id);
    const [actor] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.userRoles, eq(schema.users.id, schema.userRoles.userId))
      .where(
        and(
          eq(schema.users.id, actorId),
          eq(schema.users.status, "ACTIVE"),
          eq(schema.userRoles.roleCode, "ADMIN"),
        ),
      );
    if (!actor)
      throw new InstructorError(
        "La sesión de administración ya no está activa.",
      );
    const [user] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .for("update");
    const [profile] = await tx
      .select()
      .from(schema.instructorProfiles)
      .where(eq(schema.instructorProfiles.id, id))
      .for("update");
    if (!user || !profile)
      throw new InstructorError("El instructor no existe.");
    return { user, profile };
  }

  async setActive(
    id: string,
    actorId: string,
    active: boolean,
    expected: Date,
  ) {
    await this.db.transaction(async (tx) => {
      const { profile } = await this.lock(tx, id, actorId);
      if (profile.updatedAt.getTime() !== expected.getTime())
        throw new InstructorError(
          "El perfil cambió. Recarga antes de continuar.",
        );
      assertInstructorLifecycle(
        await inspect(tx, id),
        active ? "activate" : "deactivate",
      );
      await tx
        .update(schema.users)
        .set({ status: active ? "ACTIVE" : "DISABLED", updatedAt: new Date() })
        .where(eq(schema.users.id, id));
      await tx
        .update(schema.instructorProfiles)
        .set({
          updatedAt: new Date(Math.max(Date.now(), expected.getTime() + 1)),
        })
        .where(eq(schema.instructorProfiles.id, id));
      await tx.insert(schema.auditEvents).values({
        actorId,
        entityType: "INSTRUCTOR",
        entityId: id,
        action: active ? "INSTRUCTOR_ACTIVATED" : "INSTRUCTOR_DEACTIVATED",
      });
    });
  }

  async beginDeletion(id: string, actorId: string, expected: Date) {
    return this.db.transaction(async (tx) => {
      const { user, profile } = await this.lock(tx, id, actorId);
      const state = await inspect(tx, id);
      const [pending] = await tx
        .select()
        .from(schema.instructorAccountDeletions)
        .where(eq(schema.instructorAccountDeletions.userId, id));
      if (pending) {
        assertInstructorLifecycle(
          { ...state, deletionPending: false },
          "delete",
        );
        return pending.authUserId;
      }
      if (profile.updatedAt.getTime() !== expected.getTime())
        throw new InstructorError(
          "El perfil cambió. Recarga antes de eliminarlo.",
        );
      assertInstructorLifecycle(state, "delete");
      if (!user.authUserId)
        throw new InstructorError(
          "La cuenta no tiene una identidad de acceso válida.",
        );
      await tx
        .update(schema.users)
        .set({ status: "DISABLED", updatedAt: new Date() })
        .where(eq(schema.users.id, id));
      await tx
        .insert(schema.instructorAccountDeletions)
        .values({ userId: id, actorId, authUserId: user.authUserId });
      await tx.insert(schema.auditEvents).values({
        actorId,
        entityType: "INSTRUCTOR",
        entityId: id,
        action: "INSTRUCTOR_DELETION_REQUESTED",
      });
      return user.authUserId;
    });
  }

  async completeDeletion(id: string, actorId: string, authUserId: string) {
    await this.db.transaction(async (tx) => {
      await this.lock(tx, id, actorId);
      const [pending] = await tx
        .select()
        .from(schema.instructorAccountDeletions)
        .where(
          and(
            eq(schema.instructorAccountDeletions.userId, id),
            eq(schema.instructorAccountDeletions.authUserId, authUserId),
          ),
        );
      if (!pending || pending.completedAt)
        throw new InstructorError("La eliminación no está pendiente.");
      assertInstructorLifecycle(
        { ...(await inspect(tx, id)), deletionPending: false },
        "delete",
      );
      await tx
        .delete(schema.instructorProfiles)
        .where(eq(schema.instructorProfiles.id, id));
      await tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
      // Minimal internal tombstone preserves audit/FKs; no credential remains at the provider.
      await tx
        .update(schema.users)
        .set({
          status: "DISABLED",
          email: `deleted-${id}@tombstone.invalid`,
          name: "Instructor eliminado",
          approvedGoogleIdentityId: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, id));
      await tx
        .update(schema.instructorAccountDeletions)
        .set({ completedAt: new Date() })
        .where(eq(schema.instructorAccountDeletions.userId, id));
      await tx.insert(schema.auditEvents).values({
        actorId,
        entityType: "INSTRUCTOR",
        entityId: id,
        action: "INSTRUCTOR_DELETED",
      });
    });
  }
}
