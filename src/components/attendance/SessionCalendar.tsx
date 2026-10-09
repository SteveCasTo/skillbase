import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { es } from "react-day-picker/locale";
import { ToggleGroup } from "radix-ui";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { civilDate } from "@/components/ui/date-picker";
import {
  filterSessionRows,
  sessionStateFromToggleValues,
  type SessionStateFilter,
} from "./session-filter";
interface Props {
  listId: string;
  days: readonly string[];
  today: string;
}
const keyOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const desktopQuery = "(min-width: 64rem)";
const subscribeDesktop = (onChange: () => void) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
export default function SessionCalendar({ listId, days, today }: Props) {
  const enhanced = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [day, setDay] = useState<string>("");
  const [state, setState] = useState<SessionStateFilter>("UPCOMING");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [month, setMonth] = useState(() => civilDate(days[0] ?? today)!);
  const dateTrigger = useRef<HTMLButtonElement>(null);
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(desktopQuery).matches,
    () => false,
  );
  useEffect(() => {
    const layout = document.getElementById(listId)?.parentElement;
    const widget = layout?.querySelector<HTMLElement>(
      "[data-session-calendar]",
    );
    if (!enhanced || !layout || !widget) return;
    widget.hidden = false;
    layout.dataset.calendarReady = "true";
    return () => {
      widget.hidden = true;
      delete layout.dataset.calendarReady;
      filterSessionRows(
        layout.querySelectorAll<HTMLElement>("[data-session-day]"),
        "",
      );
      const list = document.getElementById(listId);
      if (list) list.hidden = false;
      const empty = layout.querySelector<HTMLElement>("[data-session-empty]");
      if (empty) empty.hidden = true;
    };
  }, [enhanced, listId]);
  useEffect(() => {
    if (!enhanced) return;
    const list = document.getElementById(listId);
    if (!list) return;
    const visible = filterSessionRows(
      list.querySelectorAll<HTMLElement>("[data-session-day]"),
      day,
      state,
    );
    list.hidden = visible === 0;
    const empty = list.parentElement?.querySelector<HTMLElement>(
      "[data-session-empty]",
    );
    if (empty) empty.hidden = visible !== 0;
  }, [day, state, enhanced, listId]);
  const filter = (next: string, nextState = state) => {
    setDay(next);
    setState(nextState);
    const list = document.getElementById(listId);
    const rows = document
      .getElementById(listId)
      ?.querySelectorAll<HTMLElement>("[data-session-day]");
    if (rows && list) {
      const visible = filterSessionRows(rows, next, nextState);
      list.hidden = visible === 0;
      const empty = list.parentElement?.querySelector<HTMLElement>(
        "[data-session-empty]",
      );
      if (empty) empty.hidden = visible !== 0;
    }
  };
  if (!enhanced || !days.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Button
        ref={dateTrigger}
        type="button"
        variant="outline"
        className="min-h-11 w-full lg:hidden"
        aria-expanded={calendarOpen}
        aria-controls={`${listId}-calendar`}
        onClick={() => setCalendarOpen(!calendarOpen)}
      >
        {day
          ? `Fecha: ${day.split("-").reverse().join("/")}`
          : "Filtrar por fecha"}
      </Button>
      {(desktop || calendarOpen) && (
        <div id={`${listId}-calendar`}>
          <Calendar
            mode="single"
            locale={es}
            selected={civilDate(day)}
            month={month}
            onMonthChange={setMonth}
            disabled={(date) => !days.includes(keyOf(date))}
            modifiers={{
              past: (date) => days.includes(keyOf(date)) && keyOf(date) < today,
            }}
            modifiersClassNames={{
              past: "[&_button:not([data-selected-single=true])]:bg-muted [&_button:not([data-selected-single=true])]:text-muted-foreground",
            }}
            onSelect={(date) => {
              filter(date ? keyOf(date) : "", "ALL");
              if (!desktop) {
                setCalendarOpen(false);
                dateTrigger.current?.focus({ preventScroll: true });
              }
            }}
            className="mx-auto w-full max-w-80 [--cell-size:2.5rem]"
          />
        </div>
      )}
      <fieldset className="min-w-0">
        <legend
          id={`${listId}-state-label`}
          className="mb-2 text-sm font-medium"
        >
          Estado de la sesión
        </legend>
        <ToggleGroup.Root
          type="multiple"
          role="group"
          aria-labelledby={`${listId}-state-label`}
          value={state === "ALL" && !day ? [] : [state]}
          onValueChange={(values) =>
            filter("", sessionStateFromToggleValues(values))
          }
          className="grid grid-cols-2 gap-2 lg:grid-cols-1"
        >
          {(
            [
              ...(day ? [["ALL", "Todas"] as const] : []),
              ["UPCOMING", "Próximas"],
              ["COMPLETED", "Finalizadas"],
              ["CANCELLED", "Canceladas"],
            ] as const
          ).map(([value, label]) => (
            <ToggleGroup.Item key={value} value={value} asChild>
              <Button
                type="button"
                variant={state === value ? "secondary" : "outline"}
                aria-controls={listId}
                className={
                  value === "ALL"
                    ? "col-span-2 min-h-11 w-full lg:col-span-1"
                    : "min-h-11 w-full"
                }
              >
                {label}
              </Button>
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </fieldset>
    </div>
  );
}
