import { asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { InstructorRepository } from "@/application/instructors/instructor-repository";
import {
  InstructorError,
  instructorFullName,
  type InstructorProfileData,
} from "@/domain/instructors/profile";
import * as schema from "@/server/db/schema";
import { lockInstructorSchedules } from "./instructor-schedule";
import { requireFreshRegistrationActor } from "./registration-support";

type Database = PostgresJsDatabase<typeof schema>;
export class DrizzleInstructorRepository implements InstructorRepository {
  constructor(private readonly db: Database) {}
  async list() {
    const rows = await this.db
      .select({
        profile: schema.instructorProfiles,
        email: schema.users.email,
        status: schema.users.status,
      })
      .from(schema.instructorProfiles)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.instructorProfiles.id),
      )
      .orderBy(
        asc(schema.instructorProfiles.lastName),
        asc(schema.instructorProfiles.firstName),
        asc(schema.instructorProfiles.id),
      );
    return rows.map(({ profile, email, status }) => ({
      ...profile,
      email,
      status,
    }));
  }
  async get(id: string) {
    const [row] = await this.db
      .select({
        profile: schema.instructorProfiles,
        email: schema.users.email,
        status: schema.users.status,
      })
      .from(schema.instructorProfiles)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.instructorProfiles.id),
      )
      .where(eq(schema.instructorProfiles.id, id));
    return row
      ? { ...row.profile, email: row.email, status: row.status }
      : null;
  }
  async update(
    id: string,
    data: InstructorProfileData,
    actorId: string,
    expected: Date,
  ) {
    await this.db.transaction(async (tx) => {
      await lockInstructorSchedules(tx, undefined, id);
      await requireFreshRegistrationActor(
        tx,
        actorId,
        actorId === id ? "INSTRUCTOR" : "ADMIN",
      );
      const [deletion] = await tx
        .select({ id: schema.instructorAccountDeletions.userId })
        .from(schema.instructorAccountDeletions)
        .where(eq(schema.instructorAccountDeletions.userId, id));
      if (deletion)
        throw new InstructorError(
          "La cuenta está pendiente de eliminación y no puede editarse.",
        );
      const [previous] = await tx
        .select()
        .from(schema.instructorProfiles)
        .where(eq(schema.instructorProfiles.id, id))
        .for("update");
      if (!previous || previous.updatedAt.getTime() !== expected.getTime())
        throw new InstructorError(
          "El perfil cambió. Recarga y revisa antes de guardar.",
        );
      await tx
        .update(schema.instructorProfiles)
        .set({
          ...data,
          updatedAt: new Date(
            Math.max(Date.now(), previous.updatedAt.getTime() + 1),
          ),
        })
        .where(eq(schema.instructorProfiles.id, id));
      await tx
        .update(schema.users)
        .set({ name: instructorFullName(data), updatedAt: new Date() })
        .where(eq(schema.users.id, id));
      await tx.insert(schema.auditEvents).values({
        actorId,
        entityType: "INSTRUCTOR",
        entityId: id,
        action: "INSTRUCTOR_UPDATED",
        metadata: { fields: "firstName,lastName,phone" },
      });
    });
    const result = await this.get(id);
    if (!result) throw new InstructorError("El instructor no existe.");
    return result;
  }
}
