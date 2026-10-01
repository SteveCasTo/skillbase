import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";

/** Synthetic internal profile; no provider credentials or identity guessing. */
export async function createInstructorFixture(
  db: PostgresJsDatabase<typeof schema>,
) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `instructor-${crypto.randomUUID()}@test.invalid`,
      name: "Fixture Instructor",
      status: "ACTIVE",
      authUserId: crypto.randomUUID(),
      authPrimaryProvider: "EMAIL",
    })
    .returning();
  if (!user) throw new Error("Instructor fixture missing");
  await db
    .insert(schema.userRoles)
    .values({ userId: user.id, roleCode: "INSTRUCTOR" });
  await db
    .insert(schema.instructorProfiles)
    .values({ id: user.id, firstName: "Fixture", lastName: "Instructor" });
  return { ...user, roles: ["INSTRUCTOR"] as const };
}
