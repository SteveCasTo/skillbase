import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { notifications } from "@/lib/notifications";
import type {
  InterestFormValues,
  PublicInterestFormDto,
  PublicInterestPostPayload,
  RegisterInterestInput,
} from "@/domain/interests/types";
import {
  interestGroupLabel,
  INTEREST_SUCCESS_MESSAGE,
  isPublicInterestPayload,
} from "./public-interest-presentation";

interface Props {
  action: string;
  available: boolean;
  groups: PublicInterestFormDto["groups"];
  initialValues: InterestFormValues;
  initialResult?: PublicInterestPostPayload | undefined;
}

const fields = [
  {
    name: "firstName",
    label: "Nombre",
    type: "text",
    autoComplete: "given-name",
    maxLength: 100,
    required: true,
  },
  {
    name: "lastName",
    label: "Apellidos",
    type: "text",
    autoComplete: "family-name",
    maxLength: 150,
    required: true,
  },
  {
    name: "email",
    label: "Email",
    type: "email",
    autoComplete: "email",
    maxLength: 254,
    required: true,
  },
  {
    name: "phone",
    label: "Teléfono (opcional)",
    type: "tel",
    autoComplete: "tel",
    maxLength: 32,
    required: false,
  },
] as const;

export default function PublicInterestForm({
  action,
  available,
  groups,
  initialValues,
  initialResult,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const nativeSelectRef = useRef<HTMLSelectElement>(null);
  const groupTriggerRef = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [enhancedSelect, setEnhancedSelect] = useState(false);
  const [preferredGroupId, setPreferredGroupId] = useState(
    initialValues.preferredGroupId,
  );
  const [result, setResult] = useState(initialResult);
  const [pending, setPending] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const shouldFocusResult = useRef(Boolean(initialResult));
  const issues = result?.ok === false ? result.issues : {};
  const closed =
    !available ||
    (result?.ok === false &&
      ["INTEREST_UNAVAILABLE", "COURSE_NOT_FOUND"].includes(result.code));
  const succeeded = result?.ok === true;
  const unavailablePreference =
    preferredGroupId !== "" &&
    !groups.some((group) => group.id === preferredGroupId);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setHydrated(true);
      const native = nativeSelectRef.current;
      if (native) {
        setPreferredGroupId(native.value);
        if (document.activeElement !== native) setEnhancedSelect(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!shouldFocusResult.current) return;
    const issues = result?.ok === false ? result.issues : {};
    const firstIssue = fields.find((field) => issues[field.name]);
    if (!closed && firstIssue) {
      formRef.current
        ?.querySelector<HTMLInputElement>(`[name="${firstIssue.name}"]`)
        ?.focus();
    } else if (!closed && issues.preferredGroupId) {
      (
        groupTriggerRef.current ??
        nativeSelectRef.current ??
        resultRef.current
      )?.focus();
    } else {
      resultRef.current?.focus();
    }
    shouldFocusResult.current = false;
  }, [result, closed]);

  useEffect(() => {
    if (closed || succeeded) {
      const anchor =
        document.querySelector<HTMLAnchorElement>(".interest-anchor");
      if (anchor) anchor.hidden = true;
    }
    if (succeeded) {
      // A transient notification must never turn an accepted request into an error.
      try {
        notifications.success({
          title: "Gracias por tu interés",
          duration: 6000,
        });
      } catch {
        /* Persistent confirmation remains available. */
      }
    }
  }, [closed, succeeded]);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const browserIssues: Partial<Record<keyof RegisterInterestInput, string>> =
      {};
    for (const field of fields) {
      const input = form.elements.namedItem(field.name);
      if (input instanceof HTMLInputElement && !input.validity.valid) {
        browserIssues[field.name] = input.validity.valueMissing
          ? "Completa este campo."
          : input.validity.typeMismatch
            ? "Introduce un email válido."
            : "Revisa el valor de este campo.";
      }
    }
    if (Object.keys(browserIssues).length) {
      setResult({
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Revisa los campos indicados.",
        issues: browserIssues,
      });
      shouldFocusResult.current = true;
      return;
    }
    const body = new URLSearchParams();
    new FormData(form).forEach((value, key) => {
      if (typeof value === "string") body.append(key, value);
    });
    submitting.current = true;
    setPending(true);
    setResult(undefined);
    try {
      const url = new URL(action, window.location.href);
      url.hash = "";
      const response = await fetch(url, {
        method: "POST",
        headers: { Accept: "application/json" },
        body,
      });
      if (
        response.redirected ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        throw new Error("Unexpected response");
      const payload: unknown = await response.json();
      if (!isPublicInterestPayload(payload) || response.ok !== payload.ok)
        throw new Error("Unexpected payload");
      if (payload.ok) {
        form.reset();
        setPreferredGroupId("");
      }
      setResult(payload);
      shouldFocusResult.current = true;
    } catch {
      setResult({
        ok: false,
        code: "SERVICE_UNAVAILABLE",
        message: "No se pudo completar la solicitud. Intenta nuevamente.",
        issues: {},
      });
      shouldFocusResult.current = true;
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (succeeded)
    return (
      <div
        ref={resultRef}
        className="interest-result interest-success"
        role="status"
        tabIndex={-1}
      >
        <CheckCircle2 aria-hidden="true" />
        <h3>Gracias por tu interés</h3>
        <p>{INTEREST_SUCCESS_MESSAGE}</p>
      </div>
    );

  if (closed)
    return (
      <div
        ref={resultRef}
        className="interest-result"
        role="status"
        tabIndex={-1}
      >
        <h3>Registro de interés cerrado</h3>
        <p>
          {result?.ok === false
            ? result.message
            : "Este curso ya no recibe registros de interés."}
        </p>
      </div>
    );

  return (
    <form
      ref={formRef}
      action={action}
      method="post"
      aria-label="Dejar mis datos de interés"
      aria-busy={pending}
      noValidate={hydrated}
      onSubmit={submit}
      className="interest-form"
    >
      <p className="interest-required">
        Nombre, apellidos y email son obligatorios. Los demás campos son
        opcionales.
      </p>
      {result?.ok === false && (
        <div
          ref={resultRef}
          className="interest-error-summary"
          role="alert"
          tabIndex={-1}
        >
          <p>{result.message}</p>
          {Object.keys(issues).length > 0 && (
            <ul>
              {Object.entries(issues).map(([name, message]) => (
                <li key={name}>
                  <a
                    href={`#interest-${name}`}
                    onClick={(event) => {
                      if (name === "preferredGroupId" && enhancedSelect) {
                        event.preventDefault();
                        groupTriggerRef.current?.focus();
                      }
                    }}
                  >
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="interest-fields">
        {fields.map((field) => (
          <div
            key={field.name}
            className={`interest-field interest-field-${field.name}`}
            data-invalid={Boolean(issues[field.name])}
          >
            <label htmlFor={`interest-${field.name}`}>{field.label}</label>
            <Input
              id={`interest-${field.name}`}
              name={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              maxLength={field.maxLength}
              required={field.required}
              defaultValue={initialValues[field.name]}
              readOnly={pending}
              aria-invalid={Boolean(issues[field.name])}
              aria-describedby={
                issues[field.name] ? `interest-${field.name}-error` : undefined
              }
              className="min-h-11"
            />
            {issues[field.name] && (
              <p
                className="interest-field-error"
                id={`interest-${field.name}-error`}
              >
                {issues[field.name]}
              </p>
            )}
          </div>
        ))}
        <div
          className="interest-field interest-field-group"
          data-invalid={Boolean(issues.preferredGroupId)}
        >
          <label
            id="interest-group-label"
            htmlFor={groups.length ? "interest-preferredGroupId" : undefined}
          >
            Preferencia de grupo (opcional)
          </label>
          {groups.length === 0 ? (
            <p className="interest-no-preference">Sin preferencia</p>
          ) : enhancedSelect ? (
            <>
              <input
                type="hidden"
                name="preferredGroupId"
                value={preferredGroupId}
              />
              <Select
                value={preferredGroupId || "none"}
                onValueChange={(value) =>
                  setPreferredGroupId(value === "none" ? "" : value)
                }
                disabled={pending}
              >
                <SelectTrigger
                  ref={groupTriggerRef}
                  id="interest-preferredGroupId"
                  aria-labelledby="interest-group-label"
                  aria-invalid={Boolean(issues.preferredGroupId)}
                  aria-describedby={`interest-group-help${issues.preferredGroupId ? " interest-preferredGroupId-error" : ""}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent container={portalContainer}>
                  <SelectGroup>
                    <SelectItem value="none">Sin preferencia</SelectItem>
                    {unavailablePreference && (
                      <SelectItem value={preferredGroupId} disabled>
                        Preferencia no disponible
                      </SelectItem>
                    )}
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {interestGroupLabel(group)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </>
          ) : (
            <select
              ref={nativeSelectRef}
              id="interest-preferredGroupId"
              name="preferredGroupId"
              defaultValue={initialValues.preferredGroupId}
              aria-invalid={Boolean(issues.preferredGroupId)}
              aria-describedby={`interest-group-help${issues.preferredGroupId ? " interest-preferredGroupId-error" : ""}`}
              onChange={(event) =>
                setPreferredGroupId(event.currentTarget.value)
              }
              onBlur={(event) => {
                setPreferredGroupId(event.currentTarget.value);
                setEnhancedSelect(true);
              }}
            >
              <option value="">Sin preferencia</option>
              {unavailablePreference && (
                <option value={preferredGroupId} disabled>
                  Preferencia no disponible
                </option>
              )}
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {interestGroupLabel(group)}
                </option>
              ))}
            </select>
          )}
          <p id="interest-group-help" className="interest-help">
            Elegir un horario expresa una preferencia; no asigna grupo ni
            reserva plaza.
          </p>
          {issues.preferredGroupId && (
            <p
              className="interest-field-error"
              id="interest-preferredGroupId-error"
            >
              {issues.preferredGroupId}
            </p>
          )}
        </div>
      </div>
      <Button
        type="submit"
        disabled={pending}
        className="interest-submit min-h-11"
        aria-describedby="interest-submit-help"
      >
        {pending && (
          <LoaderCircle
            aria-hidden="true"
            data-icon="inline-start"
            className="animate-spin"
          />
        )}
        {pending ? "Enviando…" : "Dejar mis datos de interés"}
      </Button>
      <p id="interest-submit-help" className="interest-help">
        Esta solicitud no reserva una plaza ni confirma una inscripción.
      </p>
      <p className="sr-only" role="status">
        {pending ? "Enviando tus datos de interés." : ""}
      </p>
      <div ref={setPortalContainer} className="interest-select-portal" />
    </form>
  );
}
