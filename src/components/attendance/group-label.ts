import type { InternalUser } from "@/domain/auth/types";
import { listGroups } from "@/application/groups/manage-groups";
import { getAssignedCourse } from "@/application/instructors/assigned-courses";
import { DrizzleGroupRepository } from "@/server/db/repositories/group-repository";
import { DrizzleAssignedCourseRepository } from "@/server/db/repositories/assigned-course-repository";
import { getDatabase } from "@/server/db/client";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
export async function attendanceGroupLabel(
  actor: InternalUser,
  courseId: string,
  groupId: string,
  instructorRoute: boolean,
) {
  const groups = instructorRoute
    ? ((
        await getAssignedCourse(
          new DrizzleAssignedCourseRepository(getDatabase()),
          actor,
          courseId,
        )
      )?.groups ?? [])
    : await listGroups(
        new DrizzleGroupRepository(getDatabase()),
        actor,
        courseId,
      );
  const index = groups.findIndex((group) => group.id === groupId);
  const group = groups[index];
  return group
    ? `Grupo ${index + 1} · ${instantToBoliviaCivil(group.startsAt).slice(11, 16)}`
    : "Grupo";
}
