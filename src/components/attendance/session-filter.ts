/** Apply the calendar selection without removing the SSR session links. */
export function filterSessionRows(
  rows: Iterable<{
    hidden: boolean | string;
    dataset: { sessionDay?: string | undefined };
  }>,
  selectedDay: string,
) {
  for (const row of rows)
    row.hidden = Boolean(selectedDay && row.dataset.sessionDay !== selectedDay);
}
