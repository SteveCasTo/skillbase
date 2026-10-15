import type { InternalUser } from "@/domain/auth/types";
import type { CourseRepository } from "@/application/courses/course-repository";
import type {
  ClosedAcademicGroupRepository,
  ClosedAcademicGroup,
} from "@/application/academic-closure/closure-repository";
import { listAdminCourses } from "@/application/courses/manage-courses";
import { listClosedAcademicGroups } from "@/application/academic-closure/manage-closure";

/** Bulk official-closure lookup: never infer eligibility from editorial state or dates. */
export async function listCertificateCourses(
  courses: CourseRepository,
  closures: ClosedAcademicGroupRepository,
  actor: InternalUser,
) {
  const source = await listAdminCourses(courses, actor);
  const closed = await listClosedAcademicGroups(
    closures,
    actor,
    source.map(({ id }) => id),
  );
  const byCourse = new Map<string, ClosedAcademicGroup[]>();
  for (const group of closed) {
    const groups = byCourse.get(group.courseId) ?? [];
    groups.push(group);
    byCourse.set(group.courseId, groups);
  }
  return source.flatMap(({ id, name, status }) => {
    const groups = byCourse.get(id) ?? [];
    return groups.length ? [{ id, name, status, groups }] : [];
  });
}
