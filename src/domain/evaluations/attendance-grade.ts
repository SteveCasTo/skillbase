import type { EffectiveAttendance } from "@/domain/attendance/types";

/** Exact ratio, rounded half-up to the persisted grade precision. Pending evidence
 * is not an absence and an empty denominator is not a zero grade. */
export function attendanceGradeHundredths(
  statuses: readonly EffectiveAttendance[],
): number | null {
  const resolved = statuses.filter((status) => status !== "PENDING");
  if (!resolved.length) return null;
  const attended = resolved.filter(
    (status) => status === "PRESENT" || status === "EXCUSED",
  ).length;
  return Math.floor(
    (attended * 20000 + resolved.length) / (2 * resolved.length),
  );
}
