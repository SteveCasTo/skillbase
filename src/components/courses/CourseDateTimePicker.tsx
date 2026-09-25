import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { es } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimePicker, validTime } from "@/components/ui/time-picker";
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

export default function CourseDateTimePicker({
  name,
  label,
  value,
  required,
  disabled = false,
  error,
}: Props) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  const [date, setDate] = useState(
    match ? `${match[3]}/${match[2]}/${match[1]}` : "",
  );
  const [time, setTime] = useState(match ? `${match[4]}:${match[5]}` : "");
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const dateField = useRef<HTMLInputElement>(null);
  const selected = parseDate(date);
  const problem =
    date && !selected
      ? "Ingresa una fecha válida (DD/MM/AAAA)."
      : time && !validTime(time)
        ? "Ingresa una hora válida (HH:mm)."
        : "";
  const combined =
    selected && validTime(time)
      ? `${selected.getFullYear().toString().padStart(4, "0")}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}T${time}`
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
      <div className="flex min-w-0 items-center gap-1 sm:gap-2">
        <Input
          ref={dateField}
          id={`${name}-date`}
          type="text"
          inputMode="numeric"
          placeholder="DD/MM/AAAA"
          value={date}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? `${name}-error` : undefined}
          className="h-11 min-w-0 flex-1 px-1 text-center text-xs tabular-nums sm:px-2 sm:text-sm"
          onChange={(event) => {
            setDate(event.target.value);
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
