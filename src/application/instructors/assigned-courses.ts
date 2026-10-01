import { requireRoles } from "@/application/auth/authorize";
import type { InternalUser } from "@/domain/auth/types";

export interface AssignedCourse {
  id: string;
  name: string;
  description: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  startsAt: Date;
  endsAt: Date;
}
export interface AssignedGroup {
  id: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  status: "PLANNED" | "CANCELLED";
}
export interface AssignedCourseRepository {
  list(instructorId: string): Promise<readonly AssignedCourse[]>;
  get(instructorId: string, courseId: string): Promise<AssignedCourse | null>;
  groups(
    instructorId: string,
    courseId: string,
  ): Promise<readonly AssignedGroup[]>;
}
export function listAssignedCourses(
  repository: AssignedCourseRepository,
  actor: InternalUser,
) {
  requireRoles(actor, ["INSTRUCTOR"]);
  return repository.list(actor.id);
}
export async function getAssignedCourse(
  repository: AssignedCourseRepository,
  actor: InternalUser,
  courseId: string,
) {
  requireRoles(actor, ["INSTRUCTOR"]);
  const course = await repository.get(actor.id, courseId);
  if (!course) return null;
  return { course, groups: await repository.groups(actor.id, courseId) };
}
