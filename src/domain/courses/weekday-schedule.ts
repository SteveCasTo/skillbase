import { boliviaCivilToInstant, instantToBoliviaCivil } from "./bolivia-time";
import { CourseDomainError } from "./errors";

/** ISO weekdays 1=Monday through 5=Friday, stored as a five-bit mask. */
export function weekdayMask(days: readonly number[]): number {
  if (
    !days.length ||
    days.some((day) => !Number.isInteger(day) || day < 1 || day > 5) ||
    new Set(days).size !== days.length
  )
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "Selecciona días hábiles distintos.",
      { weekdays: "Selecciona días de lunes a viernes sin repetir." },
    );
  return days.reduce((mask, day) => mask | (1 << (day - 1)), 0);
}

/** Planned courses own civil dates; daily class hours belong exclusively to groups. */
export const GROUP_SCHEDULE = "Lunes a viernes · horario por grupo";
export const COURSE_DATE_START_TIME = "00:00";
export const COURSE_DATE_END_TIME = "23:59";

export function planCourseDates(input: {
  startDate: string;
  weekdaysMask: number;
  totalHours: number;
  sessionMinutes: number;
}) {
  const plan = planWeekdaySchedule({
    startsAt: `${input.startDate}T${COURSE_DATE_START_TIME}`,
    weekdaysMask: input.weekdaysMask,
    totalHours: input.totalHours,
    sessionMinutes: input.sessionMinutes,
  });
  const lastDate = instantToBoliviaCivil(plan.endsAt).slice(0, 10);
  return {
    startsAt: boliviaCivilToInstant(
      `${input.startDate}T${COURSE_DATE_START_TIME}`,
    ),
    endsAt: boliviaCivilToInstant(`${lastDate}T${COURSE_DATE_END_TIME}`),
    sessionCount: plan.sessionCount,
    plannedMinutes: plan.plannedMinutes,
  };
}

export function planWeekdaySchedule(input: {
  startsAt: string;
  weekdaysMask: number;
  totalHours: number;
  sessionMinutes: number;
}) {
  const { startsAt, weekdaysMask: mask, totalHours, sessionMinutes } = input;
  if (
    !Number.isInteger(mask) ||
    mask !== 31 ||
    !Number.isInteger(totalHours) ||
    totalHours <= 0 ||
    !Number.isInteger(sessionMinutes) ||
    sessionMinutes < 15 ||
    sessionMinutes > 480
  )
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "La planificación debe ser de lunes a viernes.",
    );
  const start = boliviaCivilToInstant(startsAt);
  const civilDate = new Date(`${startsAt.slice(0, 10)}T00:00:00Z`);
  const weekday = (civilDate.getUTCDay() + 6) % 7;
  if (weekday > 4 || !(mask & (1 << weekday)))
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "El inicio debe coincidir con un día hábil seleccionado.",
      { startsAt: "Selecciona un día del horario." },
    );
  const sessionCount = Math.max(
    1,
    Math.floor((totalHours * 60 + sessionMinutes / 2) / sessionMinutes),
  );
  if (sessionCount > 1000)
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "La duración y el horario superan el máximo de 1000 sesiones.",
      {
        totalHours: "Reduce la duración total o aumenta la duración de sesión.",
      },
    );
  const sessions: { startsAt: Date; endsAt: Date }[] = [];
  for (let offset = 0; sessions.length < sessionCount; offset++) {
    const day = (weekday + offset) % 7;
    if (day > 4 || !(mask & (1 << day))) continue;
    const sessionStart = new Date(start.getTime() + offset * 86400000);
    const sessionEnd = new Date(
      sessionStart.getTime() + sessionMinutes * 60000,
    );
    if (
      instantToBoliviaCivil(sessionEnd).slice(0, 10) !==
      instantToBoliviaCivil(sessionStart).slice(0, 10)
    )
      throw new CourseDomainError(
        "VALIDATION_FAILED",
        "La sesión debe terminar el mismo día.",
        { startsAt: "Adelanta la hora de inicio." },
      );
    sessions.push({ startsAt: sessionStart, endsAt: sessionEnd });
  }
  return {
    configuredHours: totalHours,
    plannedMinutes: sessionCount * sessionMinutes,
    sessionCount,
    endsAt: sessions[sessionCount - 1]!.endsAt,
    endTime: instantToBoliviaCivil(sessions[0]!.endsAt).slice(11),
    sessions,
  };
}
