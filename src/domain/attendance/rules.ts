import {
  instantToBoliviaCivil,
  boliviaCivilToInstant,
} from "@/domain/courses/bolivia-time";
import type { AttendanceStatus, EffectiveAttendance } from "./types";
export class AttendanceError extends Error {
  constructor(
    public readonly code:
      | "VALIDATION_FAILED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONCURRENT_UPDATE"
      | "IDEMPOTENCY_CONFLICT"
      | "SCHEDULE_CONFLICT"
      | "SESSION_CANCELLED"
      | "OUTSIDE_ATTENDANCE_DAY"
      | "NOT_ENROLLED"
      | "REVIEW_REQUIRED",
    message: string,
    public readonly issues: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "AttendanceError";
  }
}
export const civilDay = (instant: Date): string =>
  instantToBoliviaCivil(instant).slice(0, 10);
export function civilDayEndExclusive(instant: Date): Date {
  return new Date(
    boliviaCivilToInstant(`${civilDay(instant)}T00:00`).getTime() + 86400000,
  );
}
export function effectiveAttendance(
  mark: AttendanceStatus | null,
  startsAt: Date,
  reviewRequired: boolean,
  now: Date,
): EffectiveAttendance {
  return (
    mark ??
    (!reviewRequired && civilDay(now) > civilDay(startsAt)
      ? "ABSENT"
      : "PENDING")
  );
}
export function attendanceSummary(
  statuses: readonly EffectiveAttendance[],
  limit: number,
) {
  validateAbsenceLimit(limit);
  let consecutiveAbsences = 0,
    maximumConsecutiveAbsences = 0;
  let currentRun = 0;
  for (const status of statuses) {
    // Pending evidence is a gap, not an absence or proof of attendance.
    // A trailing pending day must not erase an already reached warning.
    if (status === "PENDING") {
      currentRun = 0;
      continue;
    }
    if (status === "ABSENT") currentRun++;
    else currentRun = 0;
    consecutiveAbsences = currentRun;
    maximumConsecutiveAbsences = Math.max(
      maximumConsecutiveAbsences,
      consecutiveAbsences,
    );
  }
  return {
    consecutiveAbsences,
    maximumConsecutiveAbsences,
    warning: consecutiveAbsences >= limit,
    academicallyEligible: maximumConsecutiveAbsences <= limit,
  };
}
export function validateAbsenceLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 2147483647)
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "Introduce un número entero positivo de ausencias.",
      { consecutiveAbsenceLimit: "Introduce un entero positivo." },
    );
  return value;
}
export function assertAttendanceDay(
  startsAt: Date,
  now: Date,
  admin: boolean,
): void {
  if (
    civilDay(startsAt) > civilDay(now) ||
    (!admin && civilDay(startsAt) !== civilDay(now))
  )
    throw new AttendanceError(
      "OUTSIDE_ATTENDANCE_DAY",
      "El instructor registra durante el día de la sesión; administración puede corregir días anteriores.",
    );
}
export function replacementInterval(startsAt: string, minutes: number) {
  const start = boliviaCivilToInstant(startsAt);
  const end = new Date(start.getTime() + minutes * 60000);
  if (civilDay(start) !== civilDay(end))
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "La sesión debe terminar el mismo día.",
      { startsAt: "Adelanta la hora inicial." },
    );
  return { startsAt: start, endsAt: end };
}
export function canAdjustSession(
  startsAt: Date,
  now: Date,
  hasAttendance: boolean,
): boolean {
  return startsAt > now && !hasAttendance;
}
export function assertSessionAdjustable(
  startsAt: Date,
  now: Date,
  hasAttendance: boolean,
): void {
  if (!canAdjustSession(startsAt, now, hasAttendance))
    throw new AttendanceError(
      "VALIDATION_FAILED",
      "Solo se puede cancelar o reprogramar antes del inicio y sin marcas de asistencia.",
    );
}
type EncounterSession = {
  id: string;
  replacementForSessionId: string | null;
  cancelledAt: Date | null;
};
export function hasOtherActiveEncounter(
  selected: EncounterSession,
  family: readonly EncounterSession[],
): boolean {
  const rootOf = (row: EncounterSession): string => {
    let current = row;
    const visited = new Set<string>();
    while (current.replacementForSessionId) {
      if (visited.has(current.id))
        throw new AttendanceError(
          "VALIDATION_FAILED",
          "El vínculo de reemplazo no es válido.",
        );
      visited.add(current.id);
      const parent = family.find(
        (r) => r.id === current.replacementForSessionId,
      );
      if (!parent)
        throw new AttendanceError(
          "VALIDATION_FAILED",
          "El vínculo de reemplazo no es válido.",
        );
      current = parent;
    }
    return current.id;
  };
  const root = rootOf(selected);
  return family.some(
    (row) => row.id !== selected.id && !row.cancelledAt && rootOf(row) === root,
  );
}
export const intervalsOverlap = (
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
): boolean => a.startsAt < b.endsAt && b.startsAt < a.endsAt;
/** Eligibility starts when payment was actually recorded, never its backdated effective date. */
export function enrollmentActivatedAt(
  createdAt: Date,
  officialStart: Date,
  totalCents: number,
  payments: readonly { amountCents: number; recordedAt: Date }[],
): Date | null {
  let paid = 0;
  let settled = totalCents === 0 ? createdAt : null;
  for (const payment of [...payments].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
  )) {
    paid += payment.amountCents;
    if (paid >= totalCents && !settled) settled = payment.recordedAt;
  }
  return settled
    ? new Date(
        Math.max(
          createdAt.getTime(),
          officialStart.getTime(),
          settled.getTime(),
        ),
      )
    : null;
}
