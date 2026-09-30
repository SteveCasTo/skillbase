import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { es } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimePicker, validTime } from "@/components/ui/time-picker";
import { nextCourseInput } from "./course-input-filter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Props {
  name: string;
  label: string;
  value: string;
  required: boolean;
  disabled?: boolean;
  error?: string;
  weekdaysOnly?: boolean;
  futureOnly?: boolean;
}

function parseDate(value: string): Date | undefined {
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

function localDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function dateKey(date: Date) {
  return `${date.getFullYear().toString().padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Historical courses store civil instants, not inclusive registration days.
// A registration may open and close on the same day if its times are ordered.
export function dateTimeUnavailable(
  name: string,
  day: Date,
  time: string,
  bounds: { start: string; registrationStart: string; registrationEnd: string },
  today: string,
  weekdaysOnly: boolean,
  futureOnly: boolean,
) {
  const key = dateKey(day);
  if (
    (weekdaysOnly && (day.getDay() === 0 || day.getDay() === 6)) ||
    (futureOnly && key < today)
  )
    return true;
  if (name !== "registrationStartAt" && name !== "registrationEndAt")
    return false;
  const instant = `${key}T${time}`;
  if (
    bounds.start &&
    validTime(time) &&
    (name === "registrationStartAt"
      ? instant >= bounds.start
      : instant > bounds.start)
  )
    return true;
  // With no time selected, reject only dates on the wrong side of a boundary.
  // Keep same-day choices available so the user can enter a valid hour.
  if (bounds.start && key > bounds.start.slice(0, 10)) return true;
  if (name === "registrationStartAt" && bounds.registrationEnd) {
    if (key > bounds.registrationEnd.slice(0, 10)) return true;
    if (validTime(time) && instant >= bounds.registrationEnd) return true;
  }
  if (name === "registrationEndAt" && bounds.registrationStart) {
    if (key < bounds.registrationStart.slice(0, 10)) return true;
    if (validTime(time) && instant <= bounds.registrationStart) return true;
  }
  return false;
}

export default function CourseDateTimePicker({
  name,
  label,
  value,
  required,
  disabled = false,
  error,
  weekdaysOnly = false,
  futureOnly = false,
}: Props) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  const [date, setDate] = useState(
    match ? `${match[3]}/${match[2]}/${match[1]}` : value,
  );
  const [time, setTime] = useState(match ? `${match[4]}:${match[5]}` : "");
  const [open, setOpen] = useState(false);
  const [bounds, setBounds] = useState({
    start: "",
    registrationStart: "",
    registrationEnd: "",
  });
  const field = useRef<HTMLInputElement>(null);
  const dateField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = field.current?.closest("form");
    if (!form) return;
    const sync = () => {
      const data = new FormData(form);
      setBounds({
        start: String(data.get("startsAt") ?? ""),
        registrationStart: String(data.get("registrationStartAt") ?? ""),
        registrationEnd: String(data.get("registrationEndAt") ?? ""),
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
  const selected = parseDate(date);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/La_Paz",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (name: "year" | "month" | "day") =>
    parts.find((item) => item.type === name)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const blocked = Boolean(
    selected &&
    dateTimeUnavailable(
      name,
      selected,
      time,
      bounds,
      today,
      weekdaysOnly,
      futureOnly,
    ),
  );
  const problem =
    date && !selected
      ? "Ingresa una fecha válida (DD/MM/AAAA)."
      : blocked
        ? "Selecciona una fecha y hora dentro del plazo permitido."
        : time && !validTime(time)
          ? "Ingresa una hora válida (HH:mm)."
          : "";
  const combined =
    selected && !blocked && validTime(time)
      ? `${dateKey(selected)}T${time}`
      : !match && date === value && !time
        ? value
        : "";
  const fieldError = problem || error;
  const missing = required && !date && !time;

  useEffect(() => {
    dateField.current?.setCustomValidity(
      problem ||
        ((date || time) && !combined
          ? "Selecciona una fecha y hora válidas."
          : ""),
    );
  }, [problem, date, time, combined]);

  useEffect(() => {
    field.current?.dispatchEvent(
      new Event("course-form-change", { bubbles: true }),
    );
  }, [combined]);

  function validate() {
    const message =
      problem ||
      ((required && !combined) || ((date || time) && !combined)
        ? "Selecciona una fecha y hora válidas."
        : "");
    dateField.current?.setCustomValidity(message);
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      data-invalid={Boolean(fieldError)}
    >
      <label htmlFor={`${name}-date`} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
        <Input
          ref={dateField}
          id={`${name}-date`}
          type="text"
          inputMode="numeric"
          placeholder="DD/MM/AAAA"
          value={date}
          data-course-input="date"
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? `${name}-error` : undefined}
          className="h-11 min-w-0 flex-1 basis-1/2 tabular-nums sm:basis-0"
          onChange={(event) => {
            setDate(nextCourseInput("date", date, event.target.value));
            event.target.setCustomValidity("");
          }}
          onBlur={validate}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              id={`${name}-calendar`}
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
              disabled={(day) =>
                dateTimeUnavailable(
                  name,
                  day,
                  "",
                  bounds,
                  today,
                  weekdaysOnly,
                  futureOnly,
                )
              }
              onSelect={(next) => {
                if (next) {
                  setDate(localDate(next));
                  dateField.current?.setCustomValidity("");
                  setOpen(false);
                }
              }}
              autoFocus
              className="mx-auto [--cell-size:2.5rem]"
            />
          </PopoverContent>
        </Popover>
        <TimePicker
          id={`${name}-time`}
          label={`Hora de ${label.toLowerCase()}`}
          value={time}
          disabled={disabled}
          invalid={Boolean(fieldError)}
          {...(fieldError ? { errorId: `${name}-error` } : {})}
          onChange={(next) => {
            setTime(next);
            dateField.current?.setCustomValidity("");
          }}
        />
      </div>
      <input
        ref={field}
        type="hidden"
        name={name}
        value={combined}
        disabled={disabled}
      />
      {fieldError && (
        <span
          id={`${name}-error`}
          role="alert"
          className="text-destructive text-sm"
        >
          {fieldError}
        </span>
      )}
      {missing && <span className="sr-only">Fecha y hora obligatorias</span>}
    </div>
  );
}
