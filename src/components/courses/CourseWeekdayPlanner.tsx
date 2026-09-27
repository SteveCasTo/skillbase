import { useEffect, useRef, useState } from "react";
import type { CourseFormat } from "@/domain/courses/formats";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import { planWeekdaySchedule } from "@/domain/courses/weekday-schedule";
import CourseDateTimePicker from "./CourseDateTimePicker";

interface Props {
  formats: readonly Pick<
    CourseFormat,
    "id" | "totalHours" | "sessionMinutes"
  >[];
  startsAt: string;
  endsAt: string;
  error?: string;
  disabled?: boolean;
  newCourse?: boolean;
}

export default function CourseWeekdayPlanner({
  formats,
  startsAt,
  endsAt,
  error,
  disabled,
  newCourse = false,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(startsAt);
  const [formatId, setFormatId] = useState("");
  useEffect(() => {
    const form = container.current?.closest("form");
    if (!form) return;
    const sync = () => {
      const data = new FormData(form);
      setStart(String(data.get("startsAt") ?? ""));
      setFormatId(String(data.get("courseTypeId") ?? ""));
    };
    sync();
    form.addEventListener("change", sync);
    form.addEventListener("course-form-change", sync);
    return () => {
      form.removeEventListener("change", sync);
      form.removeEventListener("course-form-change", sync);
    };
  }, []);
  const format = formats.find((item) => item.id === formatId);
  let plan: ReturnType<typeof planWeekdaySchedule> | null = null;
  let problem = "";
  if (start && format?.sessionMinutes != null) {
    try {
      plan = planWeekdaySchedule({
        startsAt: start,
        weekdaysMask: 31,
        totalHours: format.totalHours,
        sessionMinutes: format.sessionMinutes,
      });
    } catch {
      problem =
        "Elige un inicio de lunes a viernes que permita terminar la clase el mismo día.";
    }
  }
  const end = plan ? instantToBoliviaCivil(plan.endsAt) : "";
  const schedule = plan
    ? `Lunes a viernes, ${start.slice(11)}–${plan.endTime}`
    : "";
  useEffect(() => {
    container.current?.dispatchEvent(
      new Event("course-form-change", { bubbles: true }),
    );
  }, [end, schedule]);
  return (
    <div ref={container} className="contents">
      <CourseDateTimePicker
        name="startsAt"
        label="Inicio de clases (Bolivia)"
        value={startsAt}
        required
        disabled={disabled ?? false}
        error={error ?? ""}
        weekdaysOnly
        futureOnly={newCourse}
      />
      <div className="flex min-w-0 flex-col gap-2 text-sm">
        <span className="font-medium">Finalización calculada</span>
        <output
          className="bg-secondary flex min-h-11 items-center rounded-lg border px-3 py-2 tabular-nums"
          aria-live="polite"
        >
          {end
            ? `${end.slice(8, 10)}/${end.slice(5, 7)}/${end.slice(0, 4)} ${end.slice(11)}`
            : "Selecciona formato, fecha y hora de inicio"}
        </output>
        <input
          type="hidden"
          name="endsAt"
          value={end || (disabled ? endsAt : "")}
          disabled={disabled}
        />
        {problem && (
          <p role="alert" className="text-destructive">
            {problem}
          </p>
        )}
      </div>
      <div className="text-sm lg:col-span-2">
        <p className="font-medium">Clases de lunes a viernes (sin feriados)</p>
        <p className="text-muted-foreground mt-1" aria-live="polite">
          {plan && format
            ? `${plan.sessionCount} sesiones de ${format.sessionMinutes} min · ${plan.plannedMinutes / 60} h planificadas${plan.plannedMinutes !== format.totalHours * 60 ? ` frente a ${format.totalHours} h configuradas` : ""}. Horario: ${schedule}.`
            : "El horario se calcula al seleccionar el formato y el inicio."}
        </p>
        <input
          type="hidden"
          name="weekdays"
          value="1,2,3,4,5"
          disabled={disabled}
        />
        <input
          type="hidden"
          name="schedule"
          value={schedule}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
