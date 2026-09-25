import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TimePicker, validTime } from "@/components/ui/time-picker";
import { Button } from "@/components/ui/button";
import { nextCourseInput } from "./course-input-filter";

const days = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;
const generated =
  /^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo)(?: y (?:Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo))*, (\d{2}:\d{2})–(\d{2}:\d{2})$/;

interface Props {
  value: string;
  error?: string;
  disabled?: boolean;
}

export default function CourseSchedulePicker({
  value,
  error,
  disabled,
}: Props) {
  const parsed = generated.exec(value);
  const [free, setFree] = useState(Boolean(value && !parsed));
  const [text, setText] = useState(value);
  const [selected, setSelected] = useState<string[]>(
    parsed ? (parsed[0].split(", ")[0] ?? "").split(" y ") : [],
  );
  const [start, setStart] = useState(parsed?.[2] ?? "");
  const [end, setEnd] = useState(parsed?.[3] ?? "");
  const [problem, setProblem] = useState("");
  const schedule =
    selected.length && validTime(start) && validTime(end) && start < end
      ? `${selected.join(" y ")}, ${start}–${end}`
      : "";
  useEffect(() => {
    document
      .getElementById("course-schedule")
      ?.dispatchEvent(new Event("course-form-change", { bubbles: true }));
  }, [schedule, free, text]);
  useEffect(() => {
    const form = document.getElementById("course-schedule")?.closest("form");
    if (!form || disabled) return;
    function check(event: Event) {
      if (free || schedule) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setProblem(
        "Elige al menos un día y un intervalo válido (la hora final debe ser posterior), o escribe un horario libre.",
      );
      document.getElementById("schedule-monday")?.focus();
    }
    form.addEventListener("submit", check, true);
    return () => form.removeEventListener("submit", check, true);
  }, [free, schedule, disabled]);

  return (
    <div className="sm:col-span-2">
      <fieldset className="flex flex-col gap-4" disabled={disabled}>
        <legend className="text-sm font-medium">Horario informativo</legend>
        {!free ? (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {days.map((day, index) => (
                <label
                  key={day}
                  className="flex min-h-11 items-center gap-2 text-sm"
                >
                  <Checkbox
                    id={index === 0 ? "schedule-monday" : undefined}
                    checked={selected.includes(day)}
                    onCheckedChange={(checked) => {
                      setSelected(
                        checked
                          ? days.filter(
                              (candidate) =>
                                selected.includes(candidate) ||
                                candidate === day,
                            )
                          : selected.filter((candidate) => candidate !== day),
                      );
                      setProblem("");
                    }}
                  />
                  {day}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              <div>
                <label htmlFor="schedule-start" className="mb-2 block text-sm">
                  Desde
                </label>
                <TimePicker
                  id="schedule-start"
                  label="Desde"
                  value={start}
                  onChange={(next) => {
                    setStart(next);
                    setProblem("");
                  }}
                />
              </div>
              <div>
                <label htmlFor="schedule-end" className="mb-2 block text-sm">
                  Hasta
                </label>
                <TimePicker
                  id="schedule-end"
                  label="Hasta"
                  value={end}
                  onChange={(next) => {
                    setEnd(next);
                    setProblem("");
                  }}
                />
              </div>
            </div>
          </>
        ) : (
          <Input
            id="course-schedule"
            aria-label="Horario informativo"
            value={text}
            data-course-input="text"
            required
            disabled={disabled}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "schedule-error" : undefined}
            onChange={(event) =>
              setText(nextCourseInput("text", text, event.target.value))
            }
          />
        )}
        <Button
          type="button"
          variant="link"
          className="h-auto w-fit p-0"
          onClick={() => {
            setFree(!free);
            setProblem("");
          }}
        >
          {free ? "Usar días y horas" : "Escribir horario libre"}
        </Button>
      </fieldset>
      {!free && (
        <input
          id="course-schedule"
          type="hidden"
          name="schedule"
          value={schedule}
        />
      )}
      {free && <input type="hidden" name="schedule" value={text} />}
      {(problem || error) && (
        <p
          id="schedule-error"
          role="alert"
          className="text-destructive mt-2 text-sm"
        >
          {problem || error}
        </p>
      )}
    </div>
  );
}
