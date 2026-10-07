import { useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { evaluationHundredths } from "@/domain/evaluations/rules";
import type {
  EvaluationComponentDto,
  EvaluationGradeDto,
} from "@/domain/evaluations/types";
import { notifications } from "@/lib/notifications";
import { gradeLabel } from "./presentation";
import type { EvaluationSaveResult } from "./mutation-types";
import type { EvaluationRouteData } from "./route";

interface Props {
  participantName: string;
  registrationId: string;
  component: EvaluationComponentDto;
  grade: EvaluationGradeDto | undefined;
  schemeRevision: number;
  attempted?: EvaluationRouteData["attemptedGrade"] | undefined;
  initialError?: string;
  canGrade: boolean;
  pending: boolean;
  save: (
    score: string,
    gradeRevision: number,
    requestKey: string,
    schemeRevision: number,
  ) => Promise<EvaluationSaveResult>;
}

export function GradeCell({
  participantName,
  registrationId,
  component,
  grade,
  schemeRevision,
  attempted,
  initialError = "",
  canGrade,
  pending,
  save,
}: Props) {
  const [draft, setDraft] = useState<{
    score: string;
    baseline: string;
    revision: number;
  } | null>(
    attempted
      ? {
          score: attempted.score,
          baseline: grade?.score ?? "",
          revision: Number(attempted.gradeRevision),
        }
      : null,
  );
  const [error, setError] = useState(initialError);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(
    Boolean(
      attempted &&
      (Number(attempted.schemeRevision) !== schemeRevision ||
        Number(attempted.gradeRevision) !== (grade?.revision ?? 0)),
    ),
  );
  const input = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const transaction = useRef<{
    fingerprint: string;
    requestKey: string;
  } | null>(null);
  const id = `grade-${registrationId}-${component.id}`;
  let valid = false;
  let dirty = Boolean(draft && draft.score !== draft.baseline);
  if (draft) {
    try {
      evaluationHundredths(draft.score, "score");
      valid = true;
      if (draft.baseline !== "")
        dirty =
          evaluationHundredths(draft.score, "score") !==
          evaluationHundredths(draft.baseline, "score");
    } catch {
      valid = false;
    }
  }
  const finish = () => {
    setDraft(null);
    transaction.current = null;
    setError("");
    setConflict(false);
    requestAnimationFrame(() =>
      editButton.current?.focus({ preventScroll: true }),
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label
        htmlFor={draft ? id : undefined}
        className="text-sm font-medium break-words"
      >
        {component.name}
        <span className="text-muted-foreground ml-2 font-normal tabular-nums">
          {gradeLabel(component.weight)} %
        </span>
        <span className="sr-only"> · {participantName}</span>
      </label>
      {draft && canGrade ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              !valid ||
              !dirty ||
              !canGrade ||
              conflict ||
              pending ||
              busy.current
            )
              return;
            busy.current = true;
            setSaving(true);
            setError("");
            const fingerprint = JSON.stringify({ ...draft, schemeRevision });
            if (transaction.current?.fingerprint !== fingerprint)
              transaction.current = {
                fingerprint,
                requestKey: crypto.randomUUID(),
              };
            const requestKey = transaction.current.requestKey;
            const notificationId = `evaluation-${requestKey}`;
            notifications.loading({
              id: notificationId,
              title: "Guardando nota…",
            });
            try {
              const result = await save(
                draft.score,
                draft.revision,
                requestKey,
                schemeRevision,
              );
              if (result.ok) {
                notifications.success({
                  id: notificationId,
                  title: "Nota guardada",
                });
                finish();
              } else {
                const issue = result.issues.score;
                setError(issue ?? result.message);
                setConflict(
                  result.code === "CONCURRENT_UPDATE" &&
                    Boolean(result.currentData),
                );
                notifications.dismiss(notificationId);
                requestAnimationFrame(() =>
                  input.current?.focus({ preventScroll: true }),
                );
              }
            } catch {
              const message =
                "No se pudo confirmar el guardado. Conservamos la nota para que puedas revisar e intentarlo de nuevo.";
              setError(message);
              notifications.dismiss(notificationId);
              requestAnimationFrame(() =>
                input.current?.focus({ preventScroll: true }),
              );
            } finally {
              busy.current = false;
              setSaving(false);
            }
          }}
        >
          <div className="flex items-center gap-1">
            <Input
              ref={input}
              autoFocus
              id={id}
              name="score"
              inputMode="decimal"
              className="min-h-11"
              value={draft.score}
              disabled={saving}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                setDraft({ ...draft, score: event.target.value });
                setError("");
              }}
              onBlur={() => {
                if (!draft.score) return;
                try {
                  evaluationHundredths(draft.score, "score");
                } catch {
                  setError("Usa un valor de 0 a 100, con hasta dos decimales.");
                }
              }}
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              disabled={!valid || !dirty || conflict || pending || saving}
              aria-label={`Guardar ${component.name} de ${participantName}`}
            >
              <Check aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              disabled={saving}
              aria-label={`Cancelar edición de ${component.name} de ${participantName}`}
              onClick={finish}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          {saving && (
            <p role="status" className="text-muted-foreground text-sm">
              Guardando…
            </p>
          )}
          {error && (
            <p
              id={`${id}-error`}
              role="alert"
              className="text-destructive text-sm"
            >
              {error}
            </p>
          )}
          {conflict && (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                Nota vigente:{" "}
                <span className="tabular-nums">
                  {grade?.score === null || grade?.score === undefined
                    ? "Pendiente"
                    : gradeLabel(grade.score)}
                </span>
                . Tu cambio se mantiene en el campo.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={saving || pending}
                onClick={() => {
                  setDraft({
                    ...draft,
                    revision: grade?.revision ?? 0,
                    baseline: grade?.score ?? "",
                  });
                  transaction.current = null;
                  setConflict(false);
                  setError("");
                  input.current?.focus({ preventScroll: true });
                }}
              >
                Continuar con esta versión
              </Button>
            </div>
          )}
        </form>
      ) : (
        <div className="flex min-h-11 items-center justify-between gap-2">
          <p className="text-sm tabular-nums">
            {grade?.score === null || grade?.score === undefined
              ? "Pendiente"
              : gradeLabel(grade.score)}
          </p>
          {canGrade && (
            <Button
              ref={editButton}
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              disabled={pending}
              aria-label={`Editar ${component.name} de ${participantName}`}
              onClick={() =>
                setDraft({
                  score: grade?.score ?? "",
                  baseline: grade?.score ?? "",
                  revision: grade?.revision ?? 0,
                })
              }
            >
              <Pencil aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
