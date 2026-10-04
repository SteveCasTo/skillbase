import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { es } from "react-day-picker/locale";
import { Button } from "./button";
import { Input } from "./input";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

interface Props {
  id: string;
  name: string;
  label: string;
  value: string;
  required?: boolean;
  disabled?: boolean;
  max?: string;
  min?: string;
  error?: string | undefined;
}
export function civilDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return undefined;
  const date = new Date(0);
  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(12, 0, 0, 0);
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() + 1 === Number(match[2]) &&
    date.getDate() === Number(match[3])
    ? date
    : undefined;
}
const keyOf = (date: Date) =>
  `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const display = (iso: string) =>
  civilDate(iso)
    ? `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
    : iso;
export function civilInput(text: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(text);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : text;
  return civilDate(iso) ? iso : "";
}
/** Shared calendar + civil-date field. The SSR control submits ISO without JS. */
export default function DatePicker({
  id,
  name,
  label,
  value,
  required = false,
  disabled = false,
  max,
  min,
  error,
}: Props) {
  const [enhanced, setEnhanced] = useState(false);
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState(error ?? "");
  const fallback = useRef<HTMLInputElement>(null);
  const control = useRef<HTMLInputElement>(null);
  const iso = civilInput(text);
  const outOfBounds = Boolean(
    iso && ((min && iso < min) || (max && iso > max)),
  );
  const problem =
    text && !iso
      ? "Ingresa una fecha válida (DD/MM/AAAA)."
      : outOfBounds
        ? "Selecciona una fecha dentro del plazo permitido."
        : "";
  const resolved = problem ? "" : iso;
  useEffect(() => {
    setText(display(fallback.current?.value ?? value));
    setEnhanced(true);
  }, [value]);
  useEffect(() => {
    if (!enhanced || !fallback.current) return;
    fallback.current.value = resolved;
    control.current?.setCustomValidity(problem);
    fallback.current.dispatchEvent(new Event("input", { bubbles: true }));
  }, [enhanced, resolved, problem]);
  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      data-invalid={Boolean(serverError || problem)}
    >
      <label
        htmlFor={enhanced ? `${id}-civil` : id}
        className="text-sm font-medium"
      >
        {label}
      </label>
      <Input
        ref={fallback}
        id={id}
        name={name}
        type={enhanced ? "hidden" : "text"}
        defaultValue={value}
        required={!enhanced && required}
        disabled={disabled}
        placeholder="AAAA-MM-DD"
        pattern="\d{4}-\d{2}-\d{2}"
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-error`}
        className="min-h-11"
      />
      {enhanced && (
        <div className="flex min-w-0 gap-2">
          <Input
            ref={control}
            id={`${id}-civil`}
            inputMode="numeric"
            value={text}
            required={required}
            disabled={disabled}
            placeholder="DD/MM/AAAA"
            data-civil-control
            aria-invalid={Boolean(serverError || problem)}
            aria-describedby={`${id}-error`}
            className="min-h-11 min-w-0 flex-1 tabular-nums"
            onChange={(event) => {
              setServerError("");
              setText(event.target.value);
            }}
          />
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                disabled={disabled}
                aria-label={`Elegir ${label.toLowerCase()}`}
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
                selected={civilDate(iso)}
                {...(civilDate(iso) ? { defaultMonth: civilDate(iso)! } : {})}
                disabled={(date) =>
                  Boolean(
                    (min && keyOf(date) < min) || (max && keyOf(date) > max),
                  )
                }
                onSelect={(date) => {
                  if (date) {
                    setServerError("");
                    setText(display(keyOf(date)));
                    setOpen(false);
                  }
                }}
                autoFocus
                className="mx-auto [--cell-size:2.5rem]"
              />
            </PopoverContent>
          </Popover>
        </div>
      )}
      <p
        id={`${id}-error`}
        data-field-error={name}
        role="alert"
        className="text-destructive text-sm empty:hidden"
      >
        {problem || serverError}
      </p>
    </div>
  );
}
