import { useRef, useState } from "react";
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
import { changedGrades, gradeDrafts, type GradeDraft } from "./editing";
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
  const name = `${participant.firstName} ${participant.lastName}`;
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
    setMessage(Object.keys(fields).length ? "" : result.message);
    setConflict(
      result.code === "CONCURRENT_UPDATE" ||
        result.code === "IDEMPOTENCY_CONFLICT",
    );
    if (Object.keys(fields).length) notifications.dismiss(id);
    else notifications.error({ id, title: "No se guardaron las notas" });
    focusError();
  };

  return (
    <form
      ref={form}
      aria-label={`Notas de ${name}`}
      aria-busy={saving}
      className="grid min-w-0 gap-x-5 gap-y-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_12rem]"
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
      <div className="min-w-0">
        <h3 className="pt-2 text-sm font-semibold break-words">{name}</h3>
        {participant.membershipStatus !== "INSCRITO" && (
          <p className="text-muted-foreground mt-1 text-sm">
            {membershipLabels[participant.membershipStatus]}
          </p>
        )}
      </div>
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] gap-x-3 gap-y-2 sm:col-span-2 lg:col-span-1 lg:col-start-2 lg:row-start-1">
        {components.map((component, index) => {
          const draft = drafts?.find(
            (draft) => draft.componentId === component.id,
          );
          const grade = participant.grades.find(
            (grade) => grade.componentId === component.id,
          );
          const id = `grade-${participant.registrationId}-${component.id}`;
          const error = errors[component.id];
          return (
            <div key={component.id} className="flex min-w-0 flex-col gap-1">
              <label
                htmlFor={draft ? id : undefined}
                className="text-muted-foreground text-xs font-medium break-words"
              >
                {component.name}
                <span className="sr-only"> · {name}</span>
              </label>
              {draft && participant.canGrade ? (
                <Input
                  autoFocus={index === 0}
                  id={id}
                  inputMode="decimal"
                  className="min-h-11 max-w-26 tabular-nums"
                  value={draft.score}
                  disabled={saving}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onChange={(event) => {
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
                <p className="flex min-h-11 max-w-26 items-center text-sm tabular-nums">
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
      <div className="flex min-w-0 flex-col items-start gap-1 sm:col-start-2 sm:row-start-1 sm:items-end lg:col-start-3">
        <div className="flex min-h-11 items-center justify-end gap-1">
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
        <EvaluationResult result={participant.result} />
      </div>
      {message && (
        <p
          role="alert"
          tabIndex={-1}
          className="text-destructive text-sm sm:col-span-2 lg:col-span-3"
        >
          {message}
        </p>
      )}
      {conflict && drafts && (
        <div className="flex flex-col items-start gap-2 text-sm sm:col-span-2 lg:col-span-3">
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
