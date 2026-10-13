import type { ClosureBlocker } from "@/domain/academic-closure/types";
import { timeLabel } from "@/components/attendance/presentation";
export const closureDateLabel = (instant: string) =>
  `${new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(instant))}, ${timeLabel(instant)}`;
export const closureBlockerLabels: Record<ClosureBlocker, string> = {
  SESSIONS_UNFINISHED: "Sesiones sin finalizar",
  GRADES_PENDING: "Notas pendientes",
  ATTENDANCE_PENDING: "Asistencia o revisión pendiente",
};
