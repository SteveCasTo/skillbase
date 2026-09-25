import { useState } from "react";
import { Clock3, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
}

export function TimePicker({
  id,
  label,
  value,
  onChange,
  disabled,
  invalid,
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
    <div className="flex min-w-0 items-center gap-1">
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH:mm"
        aria-label={label}
        aria-invalid={invalid}
        value={value}
        disabled={disabled}
        className="h-11 w-[4.5rem] px-1 text-center text-xs tabular-nums sm:w-24 sm:px-2 sm:text-sm"
        onChange={(event) => onChange(event.target.value)}
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
        <PopoverContent align="end" className="w-auto p-3">
          <div className="flex gap-4">
            {(["hours", "minutes"] as const).map((part) => (
              <div key={part} className="flex flex-col items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  {part === "hours" ? "Horas" : "Minutos"}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Aumentar ${part === "hours" ? "horas" : "minutos"}`}
                  onClick={() => adjust(part, 1)}
                >
                  <Plus aria-hidden="true" />
                </Button>
                <span className="min-w-10 text-center font-medium tabular-nums">
                  {String(part === "hours" ? hours : minutes).padStart(2, "0")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Disminuir ${part === "hours" ? "horas" : "minutos"}`}
                  onClick={() => adjust(part, -1)}
                >
                  <Minus aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
