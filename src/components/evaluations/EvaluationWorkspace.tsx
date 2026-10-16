import { useRef, useState } from "react";
import type {
  CourseEvaluationsDto,
  EvaluationComponentInput,
} from "@/domain/evaluations/types";
import { SchemeEditor } from "./SchemeEditor";
import { GradeRoster } from "./GradeRoster";
import { EvaluationHistory } from "./EvaluationHistory";
import { saveEvaluation } from "./client";
import type { EvaluationRouteData } from "./route";

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
  path,
  attemptedComponents,
  attemptedRevision,
  attemptedGrade,
  issues,
  message,
}: Props) {
  const [data, setData] = useState(initialData);
  const resetKey = useRef<string | null>(null);
  return (
    <div className="flex min-w-0 flex-col gap-8">
      {data.groupId ? (
        <>
          <GradeRoster
            data={data}
            save={(input) => saveEvaluation(path, input, data)}
            reset={async () => {
              resetKey.current ??= crypto.randomUUID();
              const result = await saveEvaluation(
                path,
                {
                  action: "reset-attendance",
                  courseId: data.courseId,
                  groupId: data.groupId!,
                  schemeRevision: data.scheme.revision,
                  requestKey: resetKey.current,
                },
                data,
              );
              if (result.ok) resetKey.current = null;
              return result;
            }}
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
