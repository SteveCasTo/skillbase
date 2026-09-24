import { useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
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

const dateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function parseDateTime(value: string): Date | undefined {
  const match = dateTimePattern.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(0);
  date.setFullYear(Number(year), Number(month) - 1, Number(day));
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day) &&
    date.getHours() === Number(hour) &&
    date.getMinutes() === Number(minute)
    ? date
    : undefined;
}

function formatDate(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

function validationMessage(value: string): string {
  if (!value) return "";
  if (!dateTimePattern.test(value))
    return "Ingresa la fecha y hora como AAAA-MM-DDTHH:mm.";
  return parseDateTime(value) ? "" : "Ingresa una fecha y hora válidas.";
}

export default function CourseDateTimePicker({
  name,
  label,
  value,
  required,
  disabled = false,
  error,
}: Props) {
  const [dateTime, setDateTime] = useState(value);
  const [message, setMessage] = useState(validationMessage(value));
  const [timeDraft, setTimeDraft] = useState(
    dateTimePattern.exec(value)?.slice(4, 6).join(":") ?? "",
  );
  const dateTimeInput = useRef<HTMLInputElement>(null);
  const selectedDate = parseDateTime(dateTime);
  const dateTimeParts = dateTimePattern.exec(dateTime);
  const inputId = `${name}-input`;
  const errorId = `${name}-error`;

  function update(value: string) {
    setDateTime(value);
    const problem = validationMessage(value);
    setMessage(problem);
    dateTimeInput.current?.setCustomValidity(problem);
  }

  function chooseDate(date: Date | undefined) {
    if (!date) return;
    const time = timePattern.test(timeDraft) ? timeDraft : "09:00";
    setTimeDraft(time);
    update(`${formatDate(date)}T${time}`);
  }

  const fieldError = message || error;

  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      data-invalid={Boolean(fieldError)}
    >
      <label
        id={`${name}-label`}
        htmlFor={inputId}
        className="text-sm font-medium"
      >
        {label}
      </label>
      <div className="flex min-w-0 gap-2">
        <input
          ref={dateTimeInput}
          id={inputId}
          className="bg-background focus-visible:ring-ring min-h-11 min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
          name={name}
          type="text"
          inputMode="text"
          placeholder="AAAA-MM-DDTHH:mm"
          value={dateTime}
          required={required}
          disabled={disabled}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? errorId : `${name}-hint`}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            const parsed = dateTimePattern.exec(nextValue);
            setTimeDraft(parsed ? `${parsed[4]}:${parsed[5]}` : "");
            update(nextValue);
          }}
          onBlur={(event) => {
            event.currentTarget.setCustomValidity(validationMessage(dateTime));
            setMessage(validationMessage(dateTime));
          }}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              id={`${name}-calendar`}
              aria-label="Elegir fecha"
              aria-describedby={`${name}-label`}
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
              selected={selectedDate}
              onSelect={chooseDate}
              autoFocus
              className="mx-auto [--cell-size:2.5rem]"
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span id={`${name}-hint`}>Hora local de Bolivia (HH:mm).</span>
        <label htmlFor={`${name}-time`}>Hora</label>
        <input
          id={`${name}-time`}
          type="text"
          inputMode="numeric"
          placeholder="18:30"
          pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
          aria-label="Hora"
          className="bg-background text-foreground focus-visible:ring-ring min-h-9 w-24 rounded-md border px-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
          value={timeDraft}
          disabled={disabled}
          onChange={(event) => {
            const time = event.currentTarget.value;
            if (!/^\d{0,2}(?::\d{0,2})?$/.test(time)) return;
            setTimeDraft(time);
            const date = dateTimeParts?.slice(1, 4);
            if (date) update(`${date[0]}-${date[1]}-${date[2]}T${time}`);
          }}
        />
      </div>
      {fieldError && (
        <span
          id={errorId}
          className="text-destructive text-sm"
          role={error ? undefined : "alert"}
        >
          {fieldError}
        </span>
      )}
    </div>
  );
}
