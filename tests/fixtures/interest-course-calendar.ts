import { instantToBoliviaCivil } from "../../src/domain/courses/bolivia-time";
import {
  GROUP_SCHEDULE,
  planCourseDates,
} from "../../src/domain/courses/weekday-schedule";

export const INTEREST_FORMAT_FIELDS = {
  totalHours: "20",
  sessionMinutes: "90",
  studentAmount: "80",
  externalAmount: "100",
} as const;

/** Match the current course form: civil dates, with class hours owned by groups. */
export function interestCourseCalendar(now = new Date()) {
  const future = new Date(now);
  future.setUTCDate(future.getUTCDate() + 365);
  while (future.getUTCDay() !== 1) future.setUTCDate(future.getUTCDate() + 1);
  const startDate = future.toISOString().slice(0, 10);
  const planned = planCourseDates({
    startDate,
    weekdaysMask: 31,
    totalHours: Number(INTEREST_FORMAT_FIELDS.totalHours),
    sessionMinutes: Number(INTEREST_FORMAT_FIELDS.sessionMinutes),
  });
  return {
    startDate,
    endDate: instantToBoliviaCivil(planned.endsAt).slice(0, 10),
    schedule: GROUP_SCHEDULE,
    weekdays: "1,2,3,4,5",
  };
}
