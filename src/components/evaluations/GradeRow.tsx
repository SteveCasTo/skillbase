import { useRef, useState } from "react";
import { participantFullName } from "@/domain/pre-registrations/participant-name";
import { Check, LoaderCircle, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { membershipLabels } from "@/components/pre-registrations/presentation";
import type {
  EvaluationComponentDto,
  EvaluationParticipantDto,
} from "@/domain/evaluations/types";
import { notifications } from "@/lib/notifications";
import { gradeLabel } from "./presentation";
import { cn } from "@/lib/utils";
import {
  acceptsGradeDraft,
  changedGrades,
  gradeDrafts,
  type GradeDraft,
} from "./editing";
import { EvaluationResult } from "./EvaluationResult";
import type { EvaluationSaveResult, SaveRow } from "./mutation-types";
import type { EvaluationRouteData } from "./route";

interface Props {
  courseId: string;
  participant: EvaluationParticipantDto;
  components: readonly EvaluationComponentDto[];
  schemeRevision: number;
  pending: boolean;
  save: SaveRow;
  attempted?: EvaluationRouteData["attemptedGrade"] | undefined;
  initialError?: string;
}

export function GradeRow({
  courseId,
  participant,
  components,
  schemeRevision,
  pending,
  save,
  attempted,
  initialError = "",
}: Props) {
  const name = participantFullName(participant);
  const componentRows = Array.from(
    { length: Math.ceil(components.length / 4) },
    (_, index) => components.slice(index * 4, index * 4 + 4),
  );
  const columns = [
    "",
    "lg:grid-cols-1",
    "lg:grid-cols-2",
    "lg:grid-cols-3",
    "lg:grid-cols-4",
  ][Math.min(components.length, 4)];
  const baseline = () =>
    gradeDrafts(
      components.map(({ id }) => id),
      participant.grades,
    );
  const [drafts, setDrafts] = useState<GradeDraft[] | null>(() =>
    attempted
      ? baseline().map((draft) =>
          draft.componentId === attempted.componentId
            ? {
                ...draft,
                score: attempted.score,
                revision: Number(attempted.gradeRevision),
              }
            : draft,
        )
      : null,
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>(
    attempted && initialError ? { [attempted.componentId]: initialError } : {},
  );
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(
    Boolean(
      attempted &&
      (Number(attempted.schemeRevision) !== schemeRevision ||
        Number(attempted.gradeRevision) !==
          (participant.grades.find(
            (grade) => grade.componentId === attempted.componentId,
          )?.revision ?? 0)),
    ),
  );
  const form = useRef<HTMLFormElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const transaction = useRef<{
    fingerprint: string;
    requestKey: string;
  } | null>(null);
  const changes = changedGrades(drafts ?? []);
  const valid = !Object.keys(changes.errors).length;
  const finish = () => {
    setDrafts(null);
    setErrors({});
    setMessage("");
    setConflict(false);
    transaction.current = null;
    requestAnimationFrame(() =>
      editButton.current?.focus({ preventScroll: true }),
    );
  };
  const focusError = () =>
    requestAnimationFrame(() =>
      (
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        form.current?.querySelector<HTMLElement>('[role="alert"]')
      )?.focus({ preventScroll: true }),
    );

  const showFailure = (
    result: Extract<EvaluationSaveResult, { ok: false }>,
    id: string,
    submitted: typeof changes.grades,
  ) => {
    const fields: Record<string, string> = {};
    for (const [key, issue] of Object.entries(result.issues)) {
      const index = /^grades\.(\d+)\./u.exec(key)?.[1];
      const componentId =
        index === undefined ? undefined : submitted[Number(index)]?.componentId;
      if (componentId) fields[componentId] = issue;
    }
    setErrors(fields);
    setMessage("");
    setConflict(
      result.code === "CONCURRENT_UPDATE" ||
        result.code === "IDEMPOTENCY_CONFLICT",
    );
    if (Object.keys(fields).length) {
      notifications.dismiss(id);
      focusError();
    } else notifications.error({ id, title: result.message });
  };

  return (
    <form
      ref={form}
      aria-label={`Notas de ${name}`}
      aria-busy={saving}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 p-4 xl:grid-cols-[minmax(10rem,1fr)_minmax(0,3fr)_9rem_5.75rem] xl:grid-rows-[auto_minmax(2.75rem,auto)_auto] xl:gap-y-1"
      onKeyDown={(event) => {
        if (event.key === "Escape" && drafts && !saving) {
          event.preventDefault();
          finish();
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          !drafts ||
          !valid ||
          !changes.grades.length ||
          conflict ||
          pending ||
          busy.current ||
          !participant.canGrade
        )
          return;
        busy.current = true;
        setSaving(true);
        setErrors({});
        setMessage("");
        const input = {
          courseId,
          registrationId: participant.registrationId,
          schemeRevision,
          grades: changes.grades,
        };
        const fingerprint = JSON.stringify(input);
        if (transaction.current?.fingerprint !== fingerprint)
          transaction.current = {
            fingerprint,
            requestKey: crypto.randomUUID(),
          };
        const requestKey = transaction.current.requestKey;
        const id = `evaluation-${requestKey}`;
        notifications.loading({ id, title: "Guardando notas…" });
        try {
          const result = await save({ ...input, requestKey });
          if (result.ok) {
            notifications.success({ id, title: "Notas guardadas" });
            finish();
          } else showFailure(result, id, changes.grades);
        } catch {
          showFailure(
            {
              ok: false,
              issues: {},
              message:
                "No se pudo confirmar el guardado. Reintenta sin cambiar los valores para recuperar la misma operación.",
            },
            id,
            changes.grades,
          );
        } finally {
          busy.current = false;
          setSaving(false);
        }
      }}
    >
      <div className="col-span-2 min-w-0 self-center xl:col-span-1 xl:row-start-2">
        <h3 className="text-sm font-semibold break-words">{name}</h3>
        {participant.membershipStatus !== "INSCRITO" && (
          <p className="text-muted-foreground mt-1 text-sm">
            {membershipLabels[participant.membershipStatus]}
          </p>
        )}
      </div>
      <div className="col-span-2 row-start-3 grid min-w-0 gap-y-2 xl:contents">
        {componentRows.map((row, rowIndex) => (
          <div
            key={row[0]!.id}
            className={cn(
              "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] gap-x-3 gap-y-1 xl:col-start-2 xl:row-span-3 xl:grid-rows-subgrid",
              columns,
            )}
          >
            {row.map((component, index) => {
              const draft = drafts?.find(
                (draft) => draft.componentId === component.id,
              );
              const grade = participant.grades.find(
                (grade) => grade.componentId === component.id,
              );
              const id = `grade-${participant.registrationId}-${component.id}`;
              const error = errors[component.id];
              return (
                <div
                  key={component.id}
                  className="row-span-3 grid min-w-0 grid-rows-subgrid gap-y-1"
                >
                  <label
                    htmlFor={draft ? id : undefined}
                    className="text-muted-foreground text-xs font-medium break-words"
                  >
                    {component.name}
                    <span className="sr-only"> · {name}</span>
                  </label>
                  {draft && participant.canGrade ? (
                    <Input
                      autoFocus={rowIndex === 0 && index === 0}
                      id={id}
                      inputMode="decimal"
                      title="Introduce una nota de 0 a 100 con punto decimal y hasta dos decimales."
                      className="min-h-11 w-20 max-w-full self-center px-2 tabular-nums"
                      value={draft.score}
                      disabled={saving}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${id}-error` : undefined}
                      onPaste={(event) => {
                        const input = event.currentTarget;
                        const next =
                          input.value.slice(0, input.selectionStart ?? 0) +
                          event.clipboardData.getData("text") +
                          input.value.slice(
                            input.selectionEnd ?? input.value.length,
                          );
                        if (!acceptsGradeDraft(next)) event.preventDefault();
                      }}
                      onChange={(event) => {
                        if (!acceptsGradeDraft(event.target.value)) return;
                        setDrafts(
                          (current) =>
                            current?.map((item) =>
                              item.componentId === component.id
                                ? { ...item, score: event.target.value }
                                : item,
                            ) ?? null,
                        );
                        setErrors((current) => {
                          const next = { ...current };
                          delete next[component.id];
                          return next;
                        });
                        setMessage("");
                        transaction.current = null;
                      }}
                      onBlur={() => {
                        const issue = changes.errors[component.id];
                        if (issue)
                          setErrors((current) => ({
                            ...current,
                            [component.id]: issue,
                          }));
                      }}
                    />
                  ) : (
                    <p className="flex min-h-11 w-20 max-w-full items-center text-sm tabular-nums">
                      {grade?.score == null ? (
                        <span className="text-muted-foreground">Pendiente</span>
                      ) : (
                        gradeLabel(grade.score)
                      )}
                    </p>
                  )}
                  {error && (
                    <p
                      id={`${id}-error`}
                      role="alert"
                      className="text-destructive text-xs"
                    >
                      {error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="col-start-1 row-start-2 min-w-0 self-center xl:col-start-3">
        {participant.result.status === "COMPLETE" && (
          <EvaluationResult result={participant.result} />
        )}
      </div>
      <div className="col-start-2 row-start-2 flex min-h-11 items-center justify-end gap-1 self-center xl:col-start-4">
        {participant.canGrade &&
          (drafts ? (
            <>
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label={`Guardar notas de ${name}`}
                title="Guardar notas"
                disabled={
                  !valid ||
                  !changes.grades.length ||
                  conflict ||
                  pending ||
                  saving
                }
              >
                {saving ? (
                  <LoaderCircle
                    className="motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Check aria-hidden="true" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label={`Cancelar edición de notas de ${name}`}
                title="Cancelar edición"
                disabled={saving}
                onClick={finish}
              >
                <X aria-hidden="true" />
              </Button>
            </>
          ) : (
            <Button
              ref={editButton}
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              aria-label={`Editar notas de ${name}`}
              title="Editar notas"
              disabled={pending}
              onClick={() => {
                setDrafts(baseline());
                transaction.current = null;
              }}
            >
              <Pencil aria-hidden="true" />
            </Button>
          ))}
        {saving && (
          <span role="status" className="sr-only">
            Guardando notas…
          </span>
        )}
      </div>
      {message && (
        <p
          role="alert"
          tabIndex={-1}
          className="text-destructive col-span-2 text-sm xl:col-span-4"
        >
          {message}
        </p>
      )}
      {conflict && drafts && (
        <div className="col-span-2 flex flex-col items-start gap-2 text-sm xl:col-span-4">
          <p>
            Revisa las notas vigentes antes de volver a guardar. Tu borrador se
            conserva.
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {components.map((component) => (
              <li key={component.id}>
                {component.name}:{" "}
                {gradeLabel(
                  participant.grades.find(
                    (grade) => grade.componentId === component.id,
                  )?.score ?? "",
                ) || "Pendiente"}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            disabled={saving || pending}
            onClick={() => {
              const latest = baseline();
              setDrafts(
                drafts.map((draft) => {
                  const current = latest.find(
                    (item) => item.componentId === draft.componentId,
                  )!;
                  return { ...current, score: draft.score };
                }),
              );
              setConflict(false);
              setErrors({});
              setMessage("");
              transaction.current = null;
              requestAnimationFrame(() =>
                form.current
                  ?.querySelector<HTMLInputElement>("input")
                  ?.focus({ preventScroll: true }),
              );
            }}
          >
            Continuar con esta versión
          </Button>
        </div>
      )}
    </form>
  );
}
