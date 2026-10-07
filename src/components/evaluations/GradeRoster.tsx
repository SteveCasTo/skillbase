import { useRef, useState } from "react";
import type { CourseEvaluationsDto } from "@/domain/evaluations/types";
import { membershipLabels } from "@/components/pre-registrations/presentation";
import { GradeCell } from "./GradeCell";
import { EvaluationResult } from "./EvaluationResult";
import type { SaveGrade } from "./mutation-types";
import type { EvaluationRouteData } from "./route";

interface Props {
  data: CourseEvaluationsDto;
  save: SaveGrade;
  onSaved: (data: CourseEvaluationsDto) => void;
  unavailableReason?: string | undefined;
  attemptedGrade?: EvaluationRouteData["attemptedGrade"] | undefined;
  initialIssues?: Readonly<Record<string, string>>;
  initialMessage?: string;
}

export function GradeRoster({
  data,
  save,
  onSaved,
  unavailableReason,
  attemptedGrade,
  initialIssues = {},
  initialMessage = "",
}: Props) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  if (!data.scheme.components.length) {
    return (
      <p className="text-muted-foreground text-sm">
        Define el esquema de evaluación del curso antes de registrar notas.
      </p>
    );
  }
  if (!data.participants.length) {
    return (
      <p className="text-muted-foreground text-sm">
        Este grupo todavía no tiene participantes para evaluar.
      </p>
    );
  }
  return (
    <section
      aria-labelledby="grade-roster-title"
      className="flex min-w-0 flex-col gap-4"
    >
      <header className="flex flex-col gap-2">
        <h2 id="grade-roster-title" className="text-xl font-semibold">
          Notas de participantes
        </h2>
        <p className="text-muted-foreground text-sm">
          Notas de 0 a 100, con hasta dos decimales. Una nota pendiente no
          equivale a una nota registrada de cero.
        </p>
        {unavailableReason && (
          <p className="text-muted-foreground text-sm">{unavailableReason}</p>
        )}
      </header>
      <ul className="flex min-w-0 flex-col gap-5">
        {data.participants.map((participant) => {
          const name = `${participant.firstName} ${participant.lastName}`;
          return (
            <li key={participant.registrationId} className="min-w-0">
              <article className="bg-card flex min-w-0 flex-col gap-5 rounded-xl border p-5">
                <header className="grid min-w-0 gap-3 lg:grid-cols-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold break-words">{name}</h3>
                    {!participant.canGrade &&
                      participant.membershipStatus !== "INSCRITO" && (
                        <p className="text-muted-foreground mt-2 text-sm">
                          {membershipLabels[participant.membershipStatus]} ·
                          Solo se pueden registrar notas de participantes
                          inscritos.
                        </p>
                      )}
                  </div>
                  <EvaluationResult result={participant.result} />
                </header>
                <div className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                  {data.scheme.components.map((component) => (
                    <GradeCell
                      key={component.id}
                      participantName={name}
                      registrationId={participant.registrationId}
                      component={component}
                      grade={participant.grades.find(
                        (grade) => grade.componentId === component.id,
                      )}
                      schemeRevision={data.scheme.revision}
                      attempted={
                        attemptedGrade?.registrationId ===
                          participant.registrationId &&
                        attemptedGrade.componentId === component.id
                          ? attemptedGrade
                          : undefined
                      }
                      initialError={
                        attemptedGrade?.registrationId ===
                          participant.registrationId &&
                        attemptedGrade.componentId === component.id
                          ? (initialIssues.score ?? initialMessage)
                          : ""
                      }
                      canGrade={participant.canGrade}
                      pending={pending}
                      save={async (
                        score,
                        gradeRevision,
                        requestKey,
                        schemeRevision,
                      ) => {
                        if (busy.current)
                          return {
                            ok: false,
                            message:
                              "Espera a que termine el guardado anterior.",
                            issues: {},
                          };
                        busy.current = true;
                        setPending(true);
                        try {
                          const result = await save({
                            courseId: data.courseId,
                            schemeRevision,
                            ...(data.groupId ? { groupId: data.groupId } : {}),
                            registrationId: participant.registrationId,
                            componentId: component.id,
                            gradeRevision,
                            score,
                            requestKey,
                          });
                          if (result.ok) onSaved(result.value);
                          else if (result.currentData)
                            onSaved(result.currentData);
                          return result;
                        } finally {
                          busy.current = false;
                          setPending(false);
                        }
                      }}
                    />
                  ))}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
