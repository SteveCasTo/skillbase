import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import {
  reportCents,
  type CourseReportGroup,
} from "@/application/courses/course-report";

export const statusLabels = {
  PUBLISHED: "Publicado",
  DRAFT: "Borrador",
  ARCHIVED: "Archivado",
} as const;
export const levelLabels = {
  BASIC: "Básico",
  INTERMEDIATE: "Medio",
  ADVANCED: "Avanzado",
} as const;
export function reportDecimal(cents: string): string {
  const value = reportCents(cents);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
export function reportDate(date: Date): string {
  const [year, month, day] = instantToBoliviaCivil(date)
    .slice(0, 10)
    .split("-");
  return `${day}/${month}/${year}`;
}
export function groupSchedule(group: CourseReportGroup): string {
  // A lone dated occurrence needs no weekday inference. In particular, legacy
  // groups without configured weekdays must not be described as Monday-only.
  if (group.weekdaysMask === null && group.schedules.length === 1) {
    const session = group.schedules[0]!;
    return `${instantToBoliviaCivil(session.startsAt).slice(11)}–${instantToBoliviaCivil(session.endsAt).slice(11)}`;
  }
  const days = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const slots = new Map<string, Set<number>>();
  for (const session of group.schedules) {
    const start = instantToBoliviaCivil(session.startsAt);
    const end = instantToBoliviaCivil(session.endsAt);
    const slot = `${start.slice(11)}–${end.slice(11)}`;
    const weekday = new Date(`${start.slice(0, 10)}T12:00:00Z`).getUTCDay();
    const existing = slots.get(slot) ?? new Set<number>();
    if (group.weekdaysMask !== null) {
      for (let day = 1; day <= 7; day++)
        if ((group.weekdaysMask & (1 << (day - 1))) !== 0)
          existing.add(day % 7);
    } else existing.add(weekday);
    slots.set(slot, existing);
  }
  return [...slots]
    .map(
      ([slot, weekdays]) =>
        `${[1, 2, 3, 4, 5, 6, 0]
          .filter((day) => weekdays.has(day))
          .map((day) => days[day])
          .join(", ")} ${slot}`,
    )
    .join("\n");
}
