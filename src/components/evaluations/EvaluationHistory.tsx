import type { CourseEvaluationsDto } from "@/domain/evaluations/types";
import { gradeLabel } from "./presentation";

export function EvaluationHistory({ data }: { data: CourseEvaluationsDto }) {
  const corrections =
    data.history?.filter((entry) => entry.fromScore !== null) ?? [];
  if (!corrections.length) return null;
  const formatter = new Intl.DateTimeFormat("es-BO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/La_Paz",
  });
  return (
    <section
      aria-labelledby="evaluation-history-title"
      className="flex flex-col gap-4"
    >
      <h2 id="evaluation-history-title" className="text-xl font-semibold">
        Historial de correcciones
      </h2>
      <ul className="bg-card divide-y rounded-xl border px-5">
        {corrections.map((entry, index) => {
          const person = data.participants.find(
            (participant) => participant.participantId === entry.participantId,
          );
          const component = data.scheme.components.find(
            (component) => component.id === entry.componentId,
          );
          return (
            <li
              key={`${entry.participantId}-${entry.componentId}-${entry.revision}-${index}`}
              className="flex flex-col gap-1 py-4 text-sm"
            >
              <p className="font-medium break-words">
                {person
                  ? `${person.firstName} ${person.lastName}`
                  : "Participante"}{" "}
                · {component?.name ?? "Componente"}
              </p>
              <p className="tabular-nums">
                {gradeLabel(entry.fromScore!)} → {gradeLabel(entry.toScore)}
              </p>
              <p className="text-muted-foreground">
                {entry.actorName ?? "Usuario del equipo"} ·{" "}
                <time dateTime={entry.recordedAt}>
                  {formatter.format(new Date(entry.recordedAt))}
                </time>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
