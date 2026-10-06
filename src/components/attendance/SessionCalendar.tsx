import { useEffect, useState, useSyncExternalStore } from "react";
import { es } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { civilDate } from "@/components/ui/date-picker";
import { filterSessionRows } from "./session-filter";
interface Props {
  listId: string;
  days: readonly string[];
  today: string;
}
const keyOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export default function SessionCalendar({ listId, days, today }: Props) {
  const enhanced = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [day, setDay] = useState<string>("");
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
    };
  }, [enhanced, listId]);
  const filter = (next: string) => {
    setDay(next);
    const rows = document
      .getElementById(listId)
      ?.querySelectorAll<HTMLElement>("[data-session-day]");
    if (rows) filterSessionRows(rows, next);
  };
  if (!enhanced || !days.length) return null;
  return (
    <div className="flex flex-col items-start gap-3">
      <Calendar
        mode="single"
        locale={es}
        selected={civilDate(day)}
        {...(days[0] ? { defaultMonth: civilDate(days[0])! } : {})}
        disabled={(date) => !days.includes(keyOf(date))}
        modifiers={{
          past: (date) => days.includes(keyOf(date)) && keyOf(date) < today,
        }}
        modifiersClassNames={{
          past: "[&_button:not([data-selected-single=true])]:bg-muted [&_button:not([data-selected-single=true])]:text-muted-foreground",
        }}
        onSelect={(date) => filter(date ? keyOf(date) : "")}
        className="[--cell-size:2.5rem]"
      />
      {day && (
        <Button type="button" variant="outline" onClick={() => filter("")}>
          Ver todas las sesiones
        </Button>
      )}
    </div>
  );
}
