import { useEffect, useRef, useState } from "react";
import type { CourseFormat } from "@/domain/courses/formats";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import {
  GROUP_SCHEDULE,
  planCourseDates,
  planWeekdaySchedule,
} from "@/domain/courses/weekday-schedule";
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
  const [startDate, setStartDate] = useState(startsAt.slice(0, 10));
  const [formatId, setFormatId] = useState("");
  const today = instantToBoliviaCivil(new Date()).slice(0, 10);
  // Older planned courses still have an hourly course schedule. Keep their
  // persisted instants on edit rather than silently converting grouped courses.
  const oldHourlyPlan =
    !newCourse && Boolean(startsAt) && !startsAt.endsWith("T00:00");
  useEffect(() => {
    const form = container.current?.closest("form");
    if (!form) return;
    const sync = () => {
      const data = new FormData(form);
      if (oldHourlyPlan) setStart(String(data.get("startsAt") ?? ""));
      setFormatId(String(data.get("courseTypeId") ?? ""));
    };
    sync();
    form.addEventListener("change", sync);
    form.addEventListener("course-form-change", sync);
    return () => {
      form.removeEventListener("change", sync);
      form.removeEventListener("course-form-change", sync);
    };
  }, [oldHourlyPlan]);
  const format = formats.find((item) => item.id === formatId);
  let plan: ReturnType<typeof planWeekdaySchedule> | null = null;
  let dates: ReturnType<typeof planCourseDates> | null = null;
  let problem = "";
  if (!oldHourlyPlan && newCourse && startDate && startDate < today)
    problem = "Selecciona una fecha que no haya pasado.";
  if (!oldHourlyPlan && startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const weekday = new Date(`${startDate}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6)
      problem = "Selecciona una fecha de lunes a viernes.";
  }
  if (
    !problem &&
    (oldHourlyPlan ? start : startDate) &&
    format?.sessionMinutes != null
  ) {
    try {
      if (oldHourlyPlan)
        plan = planWeekdaySchedule({
          startsAt: start,
          weekdaysMask: 31,
          totalHours: format.totalHours,
          sessionMinutes: format.sessionMinutes,
        });
      else
        dates = planCourseDates({
          startDate,
          weekdaysMask: 31,
          totalHours: format.totalHours,
          sessionMinutes: format.sessionMinutes,
        });
    } catch {
      problem = "Selecciona una fecha de lunes a viernes válida.";
    }
  }
  const end = plan
    ? instantToBoliviaCivil(plan.endsAt)
    : dates
      ? instantToBoliviaCivil(dates.endsAt)
      : "";
  const courseStart = dates ? instantToBoliviaCivil(dates.startsAt) : "";
  const schedule =
    oldHourlyPlan && plan
      ? `Lunes a viernes, ${start.slice(11)}–${plan.endTime}`
      : dates
        ? GROUP_SCHEDULE
        : "";
  const sessionCount = plan?.sessionCount ?? dates?.sessionCount;
  const plannedMinutes = plan?.plannedMinutes ?? dates?.plannedMinutes;
  useEffect(() => {
    container.current?.dispatchEvent(
      new Event("course-form-change", { bubbles: true }),
    );
  }, [end, schedule, courseStart]);
  return (
    <div ref={container} className="contents">
      {oldHourlyPlan ? (
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
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor="startsAt-date" className="text-sm font-medium">
            Fecha de inicio de clases (Bolivia)
          </label>
          <input
            id="startsAt-date"
            type="date"
            required
            disabled={disabled}
            min={newCourse ? today : undefined}
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            aria-invalid={Boolean(error || problem)}
            aria-describedby={error || problem ? "startsAt-error" : undefined}
            className="bg-background min-h-11 w-full rounded-lg border px-3"
          />
          <input
            type="hidden"
            name="startsAt"
            value={courseStart}
            disabled={disabled}
          />
          {(error || problem) && (
            <p
              id="startsAt-error"
              role="alert"
              className="text-destructive text-sm"
            >
              {error || problem}
            </p>
          )}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-2 text-sm">
        <span className="font-medium">Fecha de finalización calculada</span>
        <output
          className="bg-secondary flex min-h-11 items-center rounded-lg border px-3 py-2 tabular-nums"
          aria-live="polite"
        >
          {end
            ? `${end.slice(8, 10)}/${end.slice(5, 7)}/${end.slice(0, 4)}${oldHourlyPlan ? ` ${end.slice(11)}` : ""}`
            : "Selecciona formato y fecha de inicio"}
        </output>
        <input
          type="hidden"
          name="endsAt"
          value={end || (disabled ? endsAt : "")}
          disabled={disabled}
        />
        {oldHourlyPlan && problem && (
          <p role="alert" className="text-destructive">
            {problem}
          </p>
        )}
      </div>
      <div className="text-sm lg:col-span-2">
        <p className="font-medium">Clases de lunes a viernes (sin feriados)</p>
        <p className="text-muted-foreground mt-1" aria-live="polite">
          {sessionCount && format && plannedMinutes != null
            ? `${sessionCount} sesiones de ${format.sessionMinutes} min · ${plannedMinutes / 60} h planificadas${plannedMinutes !== format.totalHours * 60 ? ` frente a ${format.totalHours} h configuradas` : ""}. ${oldHourlyPlan ? `Horario: ${schedule}.` : "Cada grupo define su propia hora y capacidad."}`
            : "Selecciona formato y fecha para calcular los días de clases."}
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
