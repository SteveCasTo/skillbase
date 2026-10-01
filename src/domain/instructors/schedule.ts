import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import { overlaps } from "@/domain/groups/rules";

/** Inclusive civil date ranges, recurring L–V hours, half-open daily intervals. */
export function instructorSchedulesOverlap(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
): boolean {
  const first = [a.startsAt, b.startsAt]
    .map((d) => instantToBoliviaCivil(d).slice(0, 10))
    .sort()[1]!;
  const last = [a.endsAt, b.endsAt]
    .map((d) => instantToBoliviaCivil(d).slice(0, 10))
    .sort()[0]!;
  if (first > last || !overlaps(a.startsAt, a.endsAt, b.startsAt, b.endsAt))
    return false;
  const day = new Date(`${first}T00:00:00Z`);
  const weekday = day.getUTCDay();
  if (weekday === 6) day.setUTCDate(day.getUTCDate() + 2);
  else if (weekday === 0) day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10) <= last;
}
