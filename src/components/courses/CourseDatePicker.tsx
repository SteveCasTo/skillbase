import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { es } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import { nextCourseInput } from "./course-input-filter";

interface Props {
  name: "startDate" | "registrationStartDate" | "registrationEndDate";
  label: string;
  value: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  onDateChange?: (date: string) => void;
  futureOnly?: boolean;
}

const keyOf = (date: Date) =>
  `${date.getFullYear().toString().padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function parseCivil(value: string): Date | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(0);
  date.setFullYear(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  date.setHours(12, 0, 0, 0);
  return date.getFullYear() === Number(match[3]) &&
    date.getMonth() + 1 === Number(match[2]) &&
    date.getDate() === Number(match[1])
    ? date
    : undefined;
}

export default function CourseDatePicker({
  name,
  label,
  value,
  required = false,
  disabled = false,
  error = "",
  onDateChange,
  futureOnly = true,
}: Props) {
  const [text, setText] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value.slice(8)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
      : value,
  );
  const [bounds, setBounds] = useState({
    start: "",
    registrationStart: "",
    registrationEnd: "",
  });
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const today = instantToBoliviaCivil(new Date()).slice(0, 10);

  useEffect(() => {
    const form = hidden.current?.closest("form");
    if (!form) return;
    const sync = () => {
      const data = new FormData(form);
      setBounds({
        start: String(
          data.get("startDate") ?? data.get("startsAt") ?? "",
        ).slice(0, 10),
        registrationStart: String(data.get("registrationStartDate") ?? ""),
        registrationEnd: String(data.get("registrationEndDate") ?? ""),
      });
    };
    sync();
    form.addEventListener("course-form-change", sync);
    form.addEventListener("change", sync);
    return () => {
      form.removeEventListener("course-form-change", sync);
      form.removeEventListener("change", sync);
    };
  }, []);

  const selected = parseCivil(text);
  const date = selected ? keyOf(selected) : "";
  const blocked = (key: string, weekday: number) =>
    (name === "startDate" &&
      ((futureOnly && key < today) ||
        weekday === 0 ||
        weekday === 6 ||
        (Boolean(bounds.registrationEnd) && key <= bounds.registrationEnd))) ||
    (name === "registrationEndDate" &&
      ((Boolean(bounds.start) && key >= bounds.start) ||
        (Boolean(bounds.registrationStart) &&
          key < bounds.registrationStart))) ||
    (name === "registrationStartDate" &&
      ((Boolean(bounds.start) && key >= bounds.start) ||
        (Boolean(bounds.registrationEnd) && key > bounds.registrationEnd)));
  const problem =
    text && !selected
      ? "Ingresa una fecha válida (DD/MM/AAAA)."
      : date && selected && blocked(date, selected.getDay())
        ? "Selecciona una fecha dentro del plazo permitido."
        : "";
  const resolved = problem ? "" : date;
  useEffect(() => {
    input.current?.setCustomValidity(problem);
    onDateChange?.(resolved);
    hidden.current?.dispatchEvent(
      new Event("course-form-change", { bubbles: true }),
    );
  }, [problem, resolved, onDateChange]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={`${name}-date`} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex min-w-0 gap-2">
        <Input
          ref={input}
          id={`${name}-date`}
          type="text"
          inputMode="numeric"
          placeholder="DD/MM/AAAA"
          data-course-input="date"
          value={text}
          required={required}
          disabled={disabled}
          aria-invalid={Boolean(error || problem)}
          aria-describedby={error || problem ? `${name}-error` : undefined}
          className="h-11 min-w-0 flex-1 tabular-nums"
          onChange={(event) => {
            setText(nextCourseInput("date", text, event.target.value));
            event.target.setCustomValidity("");
          }}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              aria-label={`Elegir fecha de ${label.toLowerCase()}`}
              disabled={disabled}
            >
              <CalendarDays aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[min(20rem,calc(100vw-2rem))] p-2"
          >
            <Calendar
              mode="single"
              locale={es}
              selected={selected}
              disabled={(day) => blocked(keyOf(day), day.getDay())}
              onSelect={(next) => {
                if (!next) return;
                setText(
                  `${String(next.getDate()).padStart(2, "0")}/${String(next.getMonth() + 1).padStart(2, "0")}/${next.getFullYear()}`,
                );
                input.current?.setCustomValidity("");
                setOpen(false);
              }}
              autoFocus
              className="mx-auto [--cell-size:2.5rem]"
            />
          </PopoverContent>
        </Popover>
      </div>
      <input
        ref={hidden}
        type="hidden"
        name={name}
        value={resolved}
        disabled={disabled}
      />
      {(problem || error) && (
        <p
          id={`${name}-error`}
          role="alert"
          className="text-destructive text-sm"
        >
          {problem || error}
        </p>
      )}
    </div>
  );
}
