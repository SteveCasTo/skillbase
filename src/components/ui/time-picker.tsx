import { useState } from "react";
import { Clock3, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nextCourseInput } from "@/components/courses/course-input-filter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export const validTime = (value: string) =>
  /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  errorId?: string;
}

export function TimePicker({
  id,
  label,
  value,
  onChange,
  disabled,
  invalid,
  errorId,
}: Props) {
  const [open, setOpen] = useState(false);
  const hours = validTime(value) ? Number(value.slice(0, 2)) : 9;
  const minutes = validTime(value) ? Number(value.slice(3, 5)) : 0;
  function adjust(part: "hours" | "minutes", delta: number) {
    const next =
      part === "hours"
        ? [(hours + delta + 24) % 24, minutes]
        : [hours, (minutes + delta + 60) % 60];
    onChange(next.map((number) => String(number).padStart(2, "0")).join(":"));
  }
  return (
    <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-0">
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH:mm"
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={errorId}
        value={value}
        data-course-input="time"
        disabled={disabled}
        className="h-11 min-w-0 flex-1 tabular-nums"
        onChange={(event) =>
          onChange(nextCourseInput("time", value, event.target.value))
        }
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            aria-label={`Ajustar ${label.toLowerCase()}`}
            disabled={disabled}
          >
            <Clock3 aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-[min(18rem,calc(100vw-2rem))] p-4"
        >
          <div className="flex flex-col gap-4">
            {(["hours", "minutes"] as const).map((part) => (
              <div
                key={part}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-sm font-medium">
                  {part === "hours" ? "Horas" : "Minutos"}
                </span>
                <div className="bg-muted flex items-center gap-1 rounded-lg p-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10"
                    aria-label={`Disminuir ${part === "hours" ? "horas" : "minutos"}`}
                    onClick={() => adjust(part, -1)}
                  >
                    <Minus aria-hidden="true" />
                  </Button>
                  <output
                    className="min-w-8 text-center text-base font-semibold tabular-nums"
                    aria-live="polite"
                  >
                    {String(part === "hours" ? hours : minutes).padStart(
                      2,
                      "0",
                    )}
                  </output>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10"
                    aria-label={`Aumentar ${part === "hours" ? "horas" : "minutos"}`}
                    onClick={() => adjust(part, 1)}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
