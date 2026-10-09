import type { AttendanceSessionDto } from "@/domain/attendance/types";

export type SessionStateFilter = "ALL" | AttendanceSessionDto["status"];

/** The last pressed toggle wins; deselecting it restores every session. */
export function sessionStateFromToggleValues(
  values: readonly string[],
): SessionStateFilter {
  const value = values.at(-1);
  return value === "UPCOMING" || value === "COMPLETED" || value === "CANCELLED"
    ? value
    : "ALL";
}

/** Combine civil date and the authoritative DTO state; never infer completion. */
export function filterSessionRows(
  rows: Iterable<{
    hidden: boolean | string;
    dataset: {
      sessionDay?: string | undefined;
      sessionStatus?: string | undefined;
    };
  }>,
  selectedDay: string,
  selectedState: SessionStateFilter = "ALL",
) {
  let visible = 0;
  for (const row of rows) {
    row.hidden = Boolean(
      (selectedDay && row.dataset.sessionDay !== selectedDay) ||
      (selectedState !== "ALL" && row.dataset.sessionStatus !== selectedState),
    );
    if (!row.hidden) visible++;
  }
  return visible;
}
