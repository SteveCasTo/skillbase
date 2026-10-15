export type CourseAcademicPhase =
  "IN_PROGRESS" | "UPCOMING" | "FINISHED" | "NO_ACTIVE_GROUPS";

export const courseAcademicPhaseLabels: Record<CourseAcademicPhase, string> = {
  IN_PROGRESS: "En curso",
  UPCOMING: "Próximamente",
  FINISHED: "Finalizado",
  NO_ACTIVE_GROUPS: "Sin grupos activos",
};

export function courseAcademicPhase(
  groups: readonly {
    status: "PLANNED" | "CANCELLED";
    startsAt: Date;
    academicallyClosed: boolean;
  }[],
  now: Date,
): CourseAcademicPhase {
  const active = groups.filter((group) => group.status !== "CANCELLED");
  if (!active.length) return "NO_ACTIVE_GROUPS";
  if (
    active.some((group) => !group.academicallyClosed && group.startsAt <= now)
  )
    return "IN_PROGRESS";
  if (active.some((group) => !group.academicallyClosed && group.startsAt > now))
    return "UPCOMING";
  return "FINISHED";
}
