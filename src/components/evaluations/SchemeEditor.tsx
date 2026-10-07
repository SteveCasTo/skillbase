import { useRef, useState } from "react";
import { Check, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  evaluationHundredths,
  evaluationModality,
  validateEvaluationComponents,
} from "@/domain/evaluations/rules";
import type {
  CourseEvaluationsDto,
  EvaluationComponentInput,
  EvaluationType,
} from "@/domain/evaluations/types";
import { notifications } from "@/lib/notifications";
import { evaluationTypeLabels, gradeLabel } from "./presentation";
import { acceptsWeightDraft, weightTotal } from "./editing";
import type { SaveScheme } from "./mutation-types";

interface Props {
  data: CourseEvaluationsDto;
  save: SaveScheme;
  onSaved: (data: CourseEvaluationsDto) => void;
  unavailableReason?: string | undefined;
  attemptedComponents?: EvaluationComponentInput[] | undefined;
  attemptedRevision?: string | undefined;
  initialIssues?: Readonly<Record<string, string>>;
  initialMessage?: string;
}

export function SchemeEditor({
  data,
  save,
  onSaved,
  unavailableReason,
  attemptedComponents,
  attemptedRevision,
  initialIssues = {},
  initialMessage = "",
}: Props) {
  const canEdit = data.scheme.canEdit && !data.scheme.frozenAt;
  const persisted = data.scheme.components.map(
    ({ id, name, weight, type }) => ({ id, name, weight, type }),
  );
  const [components, setComponents] = useState<EvaluationComponentInput[]>(
    () => (canEdit ? attemptedComponents : undefined) ?? persisted,
  );
  const [revision, setRevision] = useState(
    attemptedRevision === undefined
      ? data.scheme.revision
      : Number(attemptedRevision),
  );
  const [editing, setEditing] = useState<string | null>(
    attemptedComponents?.[0]?.id ?? null,
  );
  const editingBaseline = useRef<EvaluationComponentInput | null>(null);
  const [pending, setPending] = useState(false);
  const [issues, setIssues] =
    useState<Readonly<Record<string, string>>>(initialIssues);
  const [message, setMessage] = useState(initialMessage);
  const [latest, setLatest] = useState<CourseEvaluationsDto | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const transaction = useRef<{
    fingerprint: string;
    requestKey: string;
  } | null>(null);
  const total = weightTotal(components.map(({ weight }) => weight));
  const totalLabel =
    total === null
      ? "—"
      : gradeLabel(
          `${Math.floor(total / 100)}.${String(total % 100).padStart(2, "0")}`,
        );
  const otherTotal = weightTotal(
    components.filter(({ id }) => id !== editing).map(({ weight }) => weight),
  );
  const budget = otherTotal === null ? 0 : Math.max(0, 10000 - otherTotal);
  const edited = components.find(({ id }) => id === editing);
  let componentValid = false;
  let valid = false;
  try {
    validateEvaluationComponents(components);
    valid = true;
  } catch {
    /* A draft need not total 100 yet. */
  }
  if (edited) {
    try {
      validateEvaluationComponents([{ ...edited, weight: "100" }]);
      componentValid = evaluationHundredths(edited.weight, "weight") <= budget;
    } catch {
      /* Empty and transient decimal drafts cannot be confirmed. */
    }
  }
  const dirty = JSON.stringify(components) !== JSON.stringify(persisted);
  const modality = evaluationModality(
    (canEdit ? components : data.scheme.components).map(({ type }) => type),
  );
  const change = (id: string, patch: Partial<EvaluationComponentInput>) => {
    setComponents((current) =>
      current.map((component) =>
        component.id === id ? { ...component, ...patch } : component,
      ),
    );
    setIssues({});
    setMessage("");
    transaction.current = null;
  };
  const closeEditor = () => {
    setEditing(null);
    editingBaseline.current = null;
    requestAnimationFrame(() =>
      (
        form.current?.querySelector<HTMLElement>(
          `[data-edit-component="${editing}"]`,
        ) ?? form.current?.querySelector<HTMLElement>("[data-add-component]")
      )?.focus({ preventScroll: true }),
    );
  };
  const cancelEditor = () => {
    const baseline =
      editingBaseline.current ?? persisted.find(({ id }) => id === editing);
    setComponents((current) =>
      baseline
        ? current.map((item) => (item.id === editing ? baseline : item))
        : current.filter(({ id }) => id !== editing),
    );
    setIssues({});
    setMessage("");
    transaction.current = null;
    closeEditor();
  };
  return (
    <section
      className="flex min-w-0 flex-col gap-4"
      aria-labelledby="scheme-title"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="scheme-title" className="text-xl font-semibold">
          Componentes del curso
        </h2>
        {modality && (
          <p className="text-muted-foreground text-sm">
            Modalidad {evaluationTypeLabels[modality].toLowerCase()}
          </p>
        )}
      </header>
      {canEdit ? (
        <p className="text-muted-foreground text-sm">
          Los pesos deben sumar 100%. Puedes usar hasta dos decimales.
        </p>
      ) : (
        unavailableReason && (
          <p className="text-muted-foreground text-sm">{unavailableReason}</p>
        )
      )}
      <form
        ref={form}
        className="flex min-w-0 flex-col gap-4"
        aria-busy={pending}
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            !valid ||
            !dirty ||
            !canEdit ||
            editing !== null ||
            latest ||
            busy.current
          )
            return;
          busy.current = true;
          setPending(true);
          setIssues({});
          setMessage("");
          const fingerprint = JSON.stringify({ revision, components });
          if (transaction.current?.fingerprint !== fingerprint)
            transaction.current = {
              fingerprint,
              requestKey: crypto.randomUUID(),
            };
          const requestKey = transaction.current.requestKey;
          const notificationId = `evaluation-${requestKey}`;
          notifications.loading({
            id: notificationId,
            title: "Guardando esquema…",
          });
          try {
            const result = await save({
              courseId: data.courseId,
              requestKey,
              schemeRevision: revision,
              components,
            });
            if (result.ok) {
              setLatest(null);
              transaction.current = null;
              setComponents(
                result.value.scheme.components.map(
                  ({ id, name, weight, type }) => ({ id, name, weight, type }),
                ),
              );
              setRevision(result.value.scheme.revision);
              setEditing(null);
              onSaved(result.value);
              notifications.success({
                id: notificationId,
                title: "Esquema guardado",
              });
            } else {
              setIssues(result.issues);
              setMessage(result.message);
              if (result.currentData) {
                setLatest(result.currentData);
                onSaved(result.currentData);
              }
              const invalidIndex = Object.keys(result.issues)
                .map((key) => /^components\.(\d+)\./u.exec(key)?.[1])
                .find((index) => index !== undefined);
              if (invalidIndex !== undefined) {
                const component = components[Number(invalidIndex)];
                editingBaseline.current = component ? { ...component } : null;
                setEditing(component?.id ?? null);
              }
              notifications.dismiss(notificationId);
              requestAnimationFrame(() =>
                (
                  form.current?.querySelector<HTMLElement>(
                    '[aria-invalid="true"]',
                  ) ??
                  form.current?.querySelector<HTMLElement>('[role="alert"]')
                )?.focus({ preventScroll: true }),
              );
            }
          } catch {
            setMessage(
              "No se pudo confirmar el guardado. Reintenta sin cambiar los valores para recuperar la misma operación.",
            );
            notifications.dismiss(notificationId);
          } finally {
            busy.current = false;
            setPending(false);
          }
        }}
      >
        {(canEdit ? components : data.scheme.components).length ? (
          <ul className="bg-card divide-y rounded-xl border px-4">
            {(canEdit ? components : data.scheme.components).map(
              (component, index) => {
                const open = canEdit && editing === component.id;
                const prefix = `component-${component.id}`;
                const errorFor = (field: string) =>
                  issues[`components.${index}.${field}`];
                return (
                  <li key={component.id} className="py-3">
                    {open ? (
                      <fieldset
                        disabled={pending}
                        className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_7rem] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem_auto]"
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelEditor();
                          }
                        }}
                      >
                        <legend className="sr-only">Editar componente</legend>
                        <div className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-1">
                          <label
                            htmlFor={`${prefix}-name`}
                            className="text-sm font-medium"
                          >
                            Nombre
                          </label>
                          <Input
                            id={`${prefix}-name`}
                            autoFocus
                            className="min-h-11"
                            value={component.name}
                            maxLength={100}
                            required
                            aria-invalid={Boolean(errorFor("name"))}
                            aria-describedby={
                              errorFor("name")
                                ? `${prefix}-name-error`
                                : undefined
                            }
                            onChange={(event) =>
                              change(component.id, { name: event.target.value })
                            }
                          />
                          {errorFor("name") && (
                            <p
                              id={`${prefix}-name-error`}
                              className="text-destructive text-sm"
                            >
                              {errorFor("name")}
                            </p>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                          <label
                            htmlFor={`${prefix}-type`}
                            className="text-sm font-medium"
                          >
                            Tipo
                          </label>
                          <Select
                            value={component.type}
                            disabled={pending}
                            onValueChange={(value) =>
                              change(component.id, {
                                type: value as EvaluationType,
                              })
                            }
                          >
                            <SelectTrigger
                              id={`${prefix}-type`}
                              className="min-h-11 w-full"
                              aria-invalid={Boolean(errorFor("type"))}
                              aria-describedby={
                                errorFor("type")
                                  ? `${prefix}-type-error`
                                  : undefined
                              }
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem value="THEORY">Teórica</SelectItem>
                                <SelectItem value="PRACTICAL">
                                  Práctica
                                </SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          {errorFor("type") && (
                            <p
                              id={`${prefix}-type-error`}
                              className="text-destructive text-sm"
                            >
                              {errorFor("type")}
                            </p>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                          <label
                            htmlFor={`${prefix}-weight`}
                            className="text-sm font-medium"
                          >
                            Peso (%)
                          </label>
                          <Input
                            id={`${prefix}-weight`}
                            className="min-h-11 tabular-nums"
                            inputMode="decimal"
                            value={component.weight}
                            required
                            aria-invalid={Boolean(errorFor("weight"))}
                            aria-describedby={
                              errorFor("weight")
                                ? `${prefix}-weight-error`
                                : undefined
                            }
                            onChange={(event) => {
                              if (
                                acceptsWeightDraft(event.target.value, budget)
                              )
                                change(component.id, {
                                  weight: event.target.value,
                                });
                            }}
                          />
                          {errorFor("weight") && (
                            <p
                              id={`${prefix}-weight-error`}
                              className="text-destructive text-sm"
                            >
                              {errorFor("weight")}
                            </p>
                          )}
                        </div>
                        <div className="flex items-end justify-end gap-1 sm:col-span-2 lg:col-span-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="min-h-11 min-w-11"
                            aria-label={`Confirmar ${component.name || "componente"}`}
                            title="Confirmar componente"
                            disabled={pending || !componentValid}
                            onClick={closeEditor}
                          >
                            <Check aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="min-h-11 min-w-11"
                            aria-label={`Cancelar edición de ${component.name || "componente"}`}
                            title="Cancelar edición"
                            disabled={pending}
                            onClick={cancelEditor}
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </div>
                      </fieldset>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-medium break-words">
                            {component.name || "Componente sin nombre"}
                          </h3>
                          <p className="text-muted-foreground mt-1 text-sm">
                            {evaluationTypeLabels[component.type]}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <p className="mr-2 font-semibold tabular-nums">
                            {gradeLabel(component.weight) || "—"} %
                          </p>
                          {canEdit && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="min-h-11 min-w-11"
                                data-edit-component={component.id}
                                disabled={pending || editing !== null}
                                aria-label={`Editar ${component.name || "componente"}`}
                                title="Editar componente"
                                onClick={() => {
                                  editingBaseline.current = { ...component };
                                  setEditing(component.id);
                                }}
                              >
                                <Pencil aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="min-h-11 min-w-11"
                                disabled={pending || editing !== null}
                                aria-label={`Quitar ${component.name || "componente"} del esquema`}
                                title="Quitar componente"
                                onClick={() => {
                                  setComponents((current) =>
                                    current.filter(
                                      ({ id }) => id !== component.id,
                                    ),
                                  );
                                  setIssues({});
                                  setMessage("");
                                  transaction.current = null;
                                }}
                              >
                                <Trash2 aria-hidden="true" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            Todavía no hay componentes de evaluación.
          </p>
        )}
        {canEdit && (
          <>
            {latest && (
              <section
                className="flex flex-col items-start gap-3"
                aria-labelledby="current-scheme-title"
              >
                <h3 id="current-scheme-title" className="font-semibold">
                  Esquema vigente
                </h3>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {latest.scheme.components.map((component) => (
                    <li key={component.id}>
                      {component.name}: {gradeLabel(component.weight)} %
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setRevision(latest.scheme.revision);
                    setLatest(null);
                    setIssues({});
                    setMessage("");
                    transaction.current = null;
                  }}
                >
                  Continuar con esta versión
                </Button>
              </section>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                data-add-component
                disabled={
                  pending ||
                  editing !== null ||
                  components.length >= 100 ||
                  total === null ||
                  total >= 10000
                }
                onClick={() => {
                  const id = crypto.randomUUID();
                  editingBaseline.current = null;
                  setComponents((current) => [
                    ...current,
                    { id, name: "", type: "THEORY", weight: "" },
                  ]);
                  setEditing(id);
                  setIssues({});
                  setMessage("");
                  transaction.current = null;
                }}
              >
                <Plus aria-hidden="true" />
                Añadir componente
              </Button>
              <p
                className="text-sm font-semibold tabular-nums"
                aria-live="polite"
              >
                Total: {totalLabel} % / 100 %
              </p>
            </div>
            {issues.components && (
              <p
                role="alert"
                tabIndex={-1}
                className="text-destructive text-sm"
              >
                {issues.components}
              </p>
            )}
            {message &&
              !issues.components &&
              !Object.keys(issues).some((key) =>
                /^components\.\d+\.(name|weight|type)$/u.test(key),
              ) && (
                <p
                  role="alert"
                  tabIndex={-1}
                  className="text-destructive text-sm"
                >
                  {message}
                </p>
              )}
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={pending || !dirty}
                onClick={() => {
                  setComponents(persisted);
                  setRevision(data.scheme.revision);
                  setEditing(null);
                  setLatest(null);
                  setIssues({});
                  setMessage("");
                  transaction.current = null;
                }}
              >
                Descartar cambios
              </Button>
              <Button
                type="submit"
                disabled={
                  pending ||
                  editing !== null ||
                  !valid ||
                  !dirty ||
                  Boolean(latest)
                }
              >
                {pending && (
                  <LoaderCircle
                    className="motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                )}
                {pending ? "Guardando…" : "Guardar esquema"}
              </Button>
            </div>
          </>
        )}
        {!canEdit && message && (
          <p role="alert" tabIndex={-1} className="text-destructive text-sm">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}
