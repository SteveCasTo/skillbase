import { getAttendanceGroup } from "@/application/attendance/manage-attendance";
import { getAttendanceRepository } from "@/server/attendance/service";
import { requireInternalUser } from "@/server/auth/context";
import { attendanceFailure } from "@/server/attendance/http";
import { attendanceGroupLabel } from "./group-label";
/** Complete private reads before Astro begins streaming child components. */
export async function prepareAttendanceGroupRoute(
  context: { locals: App.Locals; params: Record<string, string | undefined> },
  instructorRoute = false,
) {
  const actor = requireInternalUser(context.locals);
  const courseId = context.params.id ?? "",
    groupId = context.params.groupId ?? "";
  try {
    const group = await getAttendanceGroup(
      getAttendanceRepository(),
      actor,
      courseId,
      groupId,
    );
    const label = await attendanceGroupLabel(
      actor,
      courseId,
      groupId,
      instructorRoute,
    );
    return {
      status: 200,
      group,
      label,
      message: "",
      courseId,
      groupId,
      instructorRoute,
    };
  } catch (error) {
    const failure = attendanceFailure(error);
    return {
      status: failure.status,
      group: null,
      label: "Grupo",
      message: failure.payload.message,
      courseId,
      groupId,
      instructorRoute,
    };
  }
}
