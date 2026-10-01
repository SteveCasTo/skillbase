import { and, asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { AssignedCourseRepository } from "@/application/instructors/assigned-courses";
import * as schema from "@/server/db/schema";

const fields = {
  id: schema.courses.id,
  name: schema.courses.name,
  description: schema.courses.description,
  status: schema.courses.status,
  startsAt: schema.courses.startsAt,
  endsAt: schema.courses.endsAt,
};
export class DrizzleAssignedCourseRepository implements AssignedCourseRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}
  list(instructorId: string) {
    return this.db
      .select(fields)
      .from(schema.courses)
      .where(eq(schema.courses.instructorId, instructorId))
      .orderBy(asc(schema.courses.startsAt), asc(schema.courses.id));
  }
  async get(instructorId: string, courseId: string) {
    const [course] = await this.db
      .select(fields)
      .from(schema.courses)
      .where(
        and(
          eq(schema.courses.instructorId, instructorId),
          eq(schema.courses.id, courseId),
        ),
      );
    return course ?? null;
  }
  groups(instructorId: string, courseId: string) {
    return this.db
      .select({
        id: schema.groups.id,
        startsAt: schema.groups.startsAt,
        endsAt: schema.groups.endsAt,
        capacity: schema.groups.capacity,
        status: schema.groups.status,
      })
      .from(schema.groups)
      .innerJoin(schema.courses, eq(schema.courses.id, schema.groups.courseId))
      .where(
        and(
          eq(schema.courses.instructorId, instructorId),
          eq(schema.courses.id, courseId),
        ),
      )
      .orderBy(asc(schema.groups.startsAt), asc(schema.groups.id));
  }
}
