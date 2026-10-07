import { useRef, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
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
  const [components, setComponents] = useState<EvaluationComponentInput[]>(
    () =>
      (data.scheme.canEdit && !data.scheme.frozenAt
        ? attemptedComponents
        : undefined) ??
      data.scheme.components.map(({ id, name, weight, type }) => ({
        id,
        name,
        weight,
        type,
      })),
  );
  const [revision, setRevision] = useState(
    attemptedRevision === undefined
      ? data.scheme.revision
      : Number(attemptedRevision),
  );
  const [editing, setEditing] = useState<string | null>(
    attemptedComponents?.[0]?.id ?? null,
  );
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
  const canEdit = data.scheme.canEdit && !data.scheme.frozenAt;
  const displayedComponents = canEdit ? components : data.scheme.components;
  let valid = false;
  let total: number | null = 0;
  try {
    validateEvaluationComponents(components);
    valid = true;
  } catch {
    valid = false;
  }
  try {
    total = components.reduce(
      (sum, component) =>
        sum + evaluationHundredths(component.weight, "weight"),
      0,
    );
  } catch {
    total = null;
  }
  const totalLabel =
    total === null
      ? "—"
      : `${Math.floor(total / 100)},${String(total % 100).padStart(2, "0")}`;
  const modality = evaluationModality(
    components.map((component) => component.type),
  );
  const persisted = data.scheme.components.map(
    ({ id, name, weight, type }) => ({ id, name, weight, type }),
  );
  const dirty = JSON.stringify(components) !== JSON.stringify(persisted);
  const change = (id: string, patch: Partial<EvaluationComponentInput>) => {
    setComponents((current) =>
      current.map((component) =>
        component.id === id ? { ...component, ...patch } : component,
      ),
    );
    setIssues({});
    setMessage("");
  };

  return (
    <section
      className="flex min-w-0 flex-col gap-5"
      aria-labelledby="scheme-title"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="scheme-title" className="text-xl font-semibold">
          Componentes del curso
        </h2>
        {modality && (
          <p className="text-muted-foreground text-sm">
            Modalidad {evaluationTypeLabels[modality].toLowerCase()}
          </p>
        )}
      </header>
      <p className="text-muted-foreground text-sm">
        {data.scheme.frozenAt
          ? "El esquema ya no puede modificarse porque se guardó la primera nota del curso."
          : canEdit
            ? "Los pesos deben sumar 100 %. El esquema se conserva para todos los grupos y queda fijo al guardar la primera nota."
            : unavailableReason}
      </p>
      <form
        ref={form}
        className="flex min-w-0 flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid || !dirty || !canEdit || busy.current) return;
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
              if (invalidIndex !== undefined)
                setEditing(components[Number(invalidIndex)]?.id ?? null);
              notifications.dismiss(notificationId);
              requestAnimationFrame(() => {
                const target =
                  form.current?.querySelector<HTMLElement>(
                    '[aria-invalid="true"]',
                  ) ??
                  form.current?.querySelector<HTMLElement>('[role="alert"]');
                target?.focus({ preventScroll: true });
              });
            }
          } catch {
            setMessage(
              "No se pudo confirmar el guardado. Conservamos los cambios para que puedas revisarlos e intentarlo de nuevo.",
            );
            notifications.dismiss(notificationId);
          } finally {
            busy.current = false;
            setPending(false);
          }
        }}
      >
        {displayedComponents.length ? (
          <ul className="bg-card divide-y rounded-xl border px-5">
            {displayedComponents.map((component, index) => {
              const open = canEdit && editing === component.id;
              const prefix = `component-${component.id}`;
              const errorFor = (field: string) =>
                issues[`components.${index}.${field}`];
              return (
                <li key={component.id} className="py-5">
                  {open ? (
                    <fieldset
                      disabled={pending}
                      className="flex min-w-0 flex-col gap-4"
                    >
                      <legend className="mb-3 font-semibold">
                        Editar componente
                      </legend>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                        <div className="flex min-w-0 flex-col gap-2">
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
                        <div className="flex min-w-0 flex-col gap-2">
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
                        <div className="flex min-w-0 flex-col gap-2">
                          <label
                            htmlFor={`${prefix}-weight`}
                            className="text-sm font-medium"
                          >
                            Peso (%)
                          </label>
                          <Input
                            id={`${prefix}-weight`}
                            className="min-h-11"
                            inputMode="decimal"
                            value={component.weight}
                            required
                            aria-invalid={Boolean(errorFor("weight"))}
                            aria-describedby={
                              errorFor("weight")
                                ? `${prefix}-weight-error`
                                : undefined
                            }
                            onChange={(event) =>
                              change(component.id, {
                                weight: event.target.value,
                              })
                            }
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
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => {
                            const saved = persisted.find(
                              (item) => item.id === component.id,
                            );
                            setComponents((current) =>
                              saved
                                ? current.map((item) =>
                                    item.id === component.id ? saved : item,
                                  )
                                : current.filter(
                                    (item) => item.id !== component.id,
                                  ),
                            );
                            setEditing(null);
                            setIssues({});
                          }}
                        >
                          <X aria-hidden="true" />
                          Cancelar edición
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pending}
                          onClick={() => setEditing(null)}
                        >
                          Continuar
                        </Button>
                      </div>
                    </fieldset>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-medium break-words">
                          {component.name || "Componente sin nombre"}
                        </h3>
                        <p className="text-muted-foreground mt-1 text-sm">
                          {evaluationTypeLabels[component.type]}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <p className="font-semibold tabular-nums">
                          {gradeLabel(component.weight) || "—"} %
                        </p>
                        {canEdit && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="min-h-11 min-w-11"
                              disabled={pending}
                              aria-label={`Editar ${component.name || "componente"}`}
                              onClick={() => setEditing(component.id)}
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="min-h-11 min-w-11"
                              disabled={pending}
                              aria-label={`Quitar ${component.name || "componente"} del esquema`}
                              onClick={() => {
                                setComponents((current) =>
                                  current.filter(
                                    (item) => item.id !== component.id,
                                  ),
                                );
                                setIssues({});
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
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            Todavía no hay componentes. Define qué se evaluará y el peso de cada
            componente.
          </p>
        )}
        {canEdit && (
          <>
            {latest && (
              <section
                className="flex flex-col gap-3"
                aria-labelledby="current-scheme-title"
              >
                <h3 id="current-scheme-title" className="font-semibold">
                  Esquema vigente
                </h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {latest.scheme.components.map((component) => (
                    <li key={component.id}>
                      {component.name} · {gradeLabel(component.weight)} %
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground text-sm">
                  Revisa estos valores antes de guardar tu borrador sobre el
                  esquema vigente.
                </p>
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
                disabled={pending || components.length >= 100}
                onClick={() => {
                  const id = crypto.randomUUID();
                  setComponents((current) => [
                    ...current,
                    { id, name: "", type: "THEORY", weight: "" },
                  ]);
                  setEditing(id);
                  setIssues({});
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
            {!valid && components.length > 0 && (
              <p className="text-muted-foreground text-sm">
                Completa los nombres y pesos de 0 a 100, con hasta dos
                decimales. La suma debe ser exactamente 100 %.
              </p>
            )}
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
                  setIssues({});
                  setMessage("");
                }}
              >
                Descartar cambios
              </Button>
              <Button
                type="submit"
                disabled={pending || !valid || !dirty || Boolean(latest)}
              >
                {pending ? "Guardando…" : "Guardar esquema"}
              </Button>
            </div>
          </>
        )}
      </form>
    </section>
  );
}
