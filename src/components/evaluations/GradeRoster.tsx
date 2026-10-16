import { useRef, useState } from "react";
import { participantFullName } from "@/domain/pre-registrations/participant-name";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CourseEvaluationsDto } from "@/domain/evaluations/types";
import { GradeRow } from "./GradeRow";
import type { SaveRow } from "./mutation-types";
import type { EvaluationRouteData } from "./route";
import type { EvaluationSaveResult } from "./mutation-types";

interface Props {
  data: CourseEvaluationsDto;
  save: SaveRow;
  reset?: () => Promise<EvaluationSaveResult>;
  onSaved: (data: CourseEvaluationsDto) => void;
  unavailableReason?: string | undefined;
  attemptedGrade?: EvaluationRouteData["attemptedGrade"] | undefined;
  initialIssues?: Readonly<Record<string, string>>;
  initialMessage?: string;
}

export function GradeRoster({
  data,
  save,
  reset,
  onSaved,
  unavailableReason,
  attemptedGrade,
  initialIssues = {},
  initialMessage = "",
}: Props) {
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [resetError, setResetError] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const normalized = query
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es");
  const matches = (person: CourseEvaluationsDto["participants"][number]) =>
    participantFullName(person)
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase("es")
      .includes(normalized);
  const count = data.participants.filter((person) => matches(person)).length;
  if (!data.scheme.components.length)
    return (
      <p className="text-muted-foreground text-sm">
        Define el esquema de evaluación del curso antes de registrar notas.
      </p>
    );
  if (!data.participants.length)
    return (
      <p className="text-muted-foreground text-sm">
        Este grupo todavía no tiene participantes para evaluar.
      </p>
    );
  return (
    <section
      aria-labelledby="grade-roster-title"
      className="flex min-w-0 flex-col gap-4"
    >
      <header className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="grade-roster-title" className="text-xl font-semibold">
            Notas de participantes
          </h2>
          {data.hasAttendanceOverrides &&
            reset &&
            !data.academicGroups?.some(
              (g) => g.groupId === data.groupId && g.closed,
            ) && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 max-w-full whitespace-normal"
                disabled={pending}
                onClick={async () => {
                  if (busy.current) return;
                  busy.current = true;
                  setPending(true);
                  setResetError("");
                  try {
                    const result = await reset();
                    if (result.ok) onSaved(result.value);
                    else {
                      setResetError(result.message);
                      if (result.currentData) onSaved(result.currentData);
                    }
                  } catch {
                    setResetError(
                      "No se pudo confirmar el guardado. Reintenta.",
                    );
                  } finally {
                    busy.current = false;
                    setPending(false);
                  }
                }}
              >
                Restablecer cálculo automático
              </Button>
            )}
        </div>
        <div className="flex w-full min-w-0 flex-col gap-1">
          <label htmlFor="evaluation-search" className="sr-only">
            Buscar participante
          </label>
          <div className="flex items-center gap-1">
            <Input
              ref={search}
              id="evaluation-search"
              type="search"
              className="min-h-11"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label="Limpiar búsqueda"
                onClick={() => {
                  setQuery("");
                  search.current?.focus();
                }}
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </header>
      {resetError && (
        <p role="alert" className="text-destructive text-sm">
          {resetError}
        </p>
      )}
      {unavailableReason && (
        <p className="text-muted-foreground text-sm">{unavailableReason}</p>
      )}
      <p role="status" className="sr-only">
        {count} participantes encontrados
      </p>
      <ul className="bg-card min-w-0 rounded-xl border">
        {data.participants.map((participant, index) => (
          <li
            key={participant.registrationId}
            hidden={!matches(participant)}
            className={
              data.participants
                .slice(0, index)
                .some((person) => matches(person))
                ? "min-w-0 border-t"
                : "min-w-0"
            }
          >
            <GradeRow
              courseId={data.courseId}
              participant={participant}
              components={data.scheme.components}
              schemeRevision={data.scheme.revision}
              attempted={
                attemptedGrade?.registrationId === participant.registrationId
                  ? attemptedGrade
                  : undefined
              }
              initialError={initialIssues.score ?? initialMessage}
              pending={pending}
              save={async (input) => {
                if (busy.current)
                  return {
                    ok: false,
                    message: "Espera a que termine el guardado anterior.",
                    issues: {},
                  };
                busy.current = true;
                setPending(true);
                try {
                  const result = await save(input);
                  if (result.ok) onSaved(result.value);
                  else if (result.currentData) onSaved(result.currentData);
                  return result;
                } finally {
                  busy.current = false;
                  setPending(false);
                }
              }}
            />
          </li>
        ))}
        {count === 0 && (
          <li className="text-muted-foreground p-5 text-sm">
            No hay participantes que coincidan con la búsqueda.
          </li>
        )}
      </ul>
    </section>
  );
}
