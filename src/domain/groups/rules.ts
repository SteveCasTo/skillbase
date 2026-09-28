import {
  boliviaCivilToInstant,
  instantToBoliviaCivil,
} from "@/domain/courses/bolivia-time";
import { planWeekdaySchedule } from "@/domain/courses/weekday-schedule";

export type GroupErrorCode =
  | "VALIDATION_FAILED"
  | "COURSE_UNAVAILABLE"
  | "GROUP_NOT_FOUND"
  | "GROUP_CANCELLED"
  | "GROUP_ACTIVE"
  | "GROUP_PUBLISHED"
  | "STALE_GROUP"
  | "SCHEDULE_CONFLICT";

export class GroupError extends Error {
  constructor(
    readonly code: GroupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GroupError";
  }
}

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export function assertCapacity(capacity: number): void {
  if (
    !Number.isSafeInteger(capacity) ||
    capacity <= 0 ||
    capacity > POSTGRES_INTEGER_MAX
  )
    throw new GroupError(
      "VALIDATION_FAILED",
      "La capacidad debe ser un entero positivo.",
    );
}

export function groupPlan(
  course: {
    startsAt: Date;
    endsAt: Date;
    weekdaysMask: number | null;
  },
  revision: { totalHours: number; sessionMinutes: number | null },
  startTime: string,
) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime))
    throw new GroupError(
      "VALIDATION_FAILED",
      "Indica una hora de inicio HH:mm válida.",
    );
  if (course.weekdaysMask !== 31 || revision.sessionMinutes === null)
    throw new GroupError(
      "COURSE_UNAVAILABLE",
      "El curso no tiene planificación estructurada.",
    );
  const startDate = instantToBoliviaCivil(course.startsAt).slice(0, 10);
  try {
    const plan = planWeekdaySchedule({
      startsAt: `${startDate}T${startTime}`,
      weekdaysMask: course.weekdaysMask,
      totalHours: revision.totalHours,
      sessionMinutes: revision.sessionMinutes,
    });
    // A group's daily hour may differ; the final civil date must still be the course's.
    if (
      instantToBoliviaCivil(plan.endsAt).slice(0, 10) !==
      instantToBoliviaCivil(course.endsAt).slice(0, 10)
    )
      throw new GroupError(
        "COURSE_UNAVAILABLE",
        "La fecha final del curso no coincide con el plan.",
      );
    return {
      startsAt: boliviaCivilToInstant(`${startDate}T${startTime}`),
      endsAt: plan.endsAt,
      sessionCount: plan.sessionCount,
      plannedMinutes: plan.plannedMinutes,
      endTime: plan.endTime,
    };
  } catch (error) {
    if (error instanceof GroupError) throw error;
    throw new GroupError(
      "VALIDATION_FAILED",
      "El horario debe terminar el mismo día, de lunes a viernes.",
    );
  }
}

export function overlaps(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean {
  // All groups of a course share dates and recur Monday-Friday. Half-open intervals allow adjacency.
  const minutes = (date: Date) =>
    Number(instantToBoliviaCivil(date).slice(11, 13)) * 60 +
    Number(instantToBoliviaCivil(date).slice(14));
  return minutes(startA) < minutes(endB) && minutes(startB) < minutes(endA);
}
