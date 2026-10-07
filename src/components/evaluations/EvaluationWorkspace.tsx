import { useState } from "react";
import type {
  CourseEvaluationsDto,
  EvaluationComponentInput,
} from "@/domain/evaluations/types";
import { SchemeEditor } from "./SchemeEditor";
import { GradeRoster } from "./GradeRoster";
import { EvaluationHistory } from "./EvaluationHistory";
import { saveEvaluation } from "./client";
import type { EvaluationRouteData } from "./route";
import {
  evaluationPrefix,
  evaluationTypeLabels,
  gradeLabel,
} from "./presentation";

interface Props {
  initialData: CourseEvaluationsDto;
  instructorRoute: boolean;
  path: string;
  attemptedComponents?: EvaluationComponentInput[] | undefined;
  attemptedRevision?: string | undefined;
  attemptedGrade?: EvaluationRouteData["attemptedGrade"] | undefined;
  issues: Readonly<Record<string, string>>;
  message: string;
}

export function EvaluationWorkspace({
  initialData,
  instructorRoute,
  path,
  attemptedComponents,
  attemptedRevision,
  attemptedGrade,
  issues,
  message,
}: Props) {
  const [data, setData] = useState(initialData);
  const schemePath = `${evaluationPrefix(instructorRoute)}/${data.courseId}/evaluaciones`;
  return (
    <div className="flex min-w-0 flex-col gap-8">
      {data.groupId ? (
        <>
          <section
            aria-labelledby="group-scheme-title"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="group-scheme-title" className="text-xl font-semibold">
                Esquema del curso
              </h2>
              <a
                href={schemePath}
                className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
              >
                {data.scheme.frozenAt
                  ? "Consultar esquema"
                  : "Configurar esquema"}
              </a>
            </div>
            {data.scheme.frozenAt && (
              <p className="text-muted-foreground text-sm">
                Los componentes y pesos están fijos porque ya se guardó la
                primera nota del curso.
              </p>
            )}
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {data.scheme.components.map((component) => (
                <li key={component.id} className="min-w-0 break-words">
                  {component.name} · {evaluationTypeLabels[component.type]} ·{" "}
                  <span className="tabular-nums">
                    {gradeLabel(component.weight)} %
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <GradeRoster
            data={data}
            save={(input) => saveEvaluation(path, input)}
            onSaved={setData}
            unavailableReason={data.unavailableReason ?? undefined}
            attemptedGrade={attemptedGrade}
            initialIssues={issues}
            initialMessage={message}
          />
          <EvaluationHistory data={data} />
        </>
      ) : (
        <SchemeEditor
          data={data}
          save={(input) => saveEvaluation(path, input)}
          onSaved={setData}
          unavailableReason={data.unavailableReason ?? undefined}
          attemptedComponents={attemptedComponents}
          attemptedRevision={attemptedRevision}
          initialIssues={issues}
          initialMessage={message}
        />
      )}
    </div>
  );
}
