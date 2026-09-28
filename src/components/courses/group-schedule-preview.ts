/** Display-only preview; group rules and overlap validation remain authoritative on the server. */
export function groupEndTime(
  startTime: string,
  sessionMinutes: number | null,
): string | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || sessionMinutes === null)
    return null;
  const [hours, minutes] = startTime.split(":").map(Number);
  const end = hours! * 60 + minutes! + sessionMinutes;
  if (!Number.isInteger(sessionMinutes) || end >= 1440) return null;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}
