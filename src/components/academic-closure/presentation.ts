import type { ClosureBlocker } from "@/domain/academic-closure/types";
import { dateLabel, timeLabel } from "@/components/attendance/presentation";
export const closureDateLabel = (instant: string) =>
  `${dateLabel(instant)}, ${timeLabel(instant)}`;
export const closureBlockerLabels: Record<ClosureBlocker, string> = {
  SESSIONS_UNFINISHED: "Sesiones sin finalizar",
  GRADES_PENDING: "Notas pendientes",
  ATTENDANCE_PENDING: "Asistencia o revisión pendiente",
};
