import {
  registrationSettingsFormState,
  type RegistrationSettingsFormInput,
  type RegistrationSettingsFormValues,
} from "./registration-settings-form-state";
import { notifications } from "@/lib/notifications";
import { createRequestState, requestFingerprint } from "./request-state";

interface SettingsResult {
  readonly minimumPaymentPercent: number;
  readonly auxiliaryDiscountPercent: number;
  readonly revision: number;
}

class SettingsRequestError extends Error {
  constructor(
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
    readonly code?: string,
  ) {
    super(message);
  }
}

async function saveSettings(
  form: HTMLFormElement,
  values: Record<string, string>,
): Promise<SettingsResult> {
  const body = new URLSearchParams(values);
  const response = await fetch(form.action, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    const message =
      typeof record.message === "string"
        ? record.message
        : "No se pudo guardar la configuración. Inténtalo nuevamente.";
    const fields =
      record.fields && typeof record.fields === "object"
        ? Object.fromEntries(
            Object.entries(record.fields).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          )
        : {};
    throw new SettingsRequestError(
      message,
      fields,
      typeof record.code === "string" ? record.code : undefined,
    );
  }
  if (!payload || typeof payload !== "object" || !("settings" in payload))
    throw new SettingsRequestError(
      "No se pudo confirmar la configuración guardada. Recarga la página.",
    );
  const settings = payload.settings;
  const minimumPaymentPercent =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).minimumPaymentPercent
      : undefined;
  const auxiliaryDiscountPercent =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).auxiliaryDiscountPercent
      : undefined;
  const revision =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).revision
      : undefined;
  if (
    !Number.isInteger(minimumPaymentPercent) ||
    (minimumPaymentPercent as number) < 1 ||
    (minimumPaymentPercent as number) > 100 ||
    !Number.isInteger(auxiliaryDiscountPercent) ||
    (auxiliaryDiscountPercent as number) < 0 ||
    (auxiliaryDiscountPercent as number) > 100 ||
    !Number.isInteger(revision)
  )
    throw new SettingsRequestError(
      "La respuesta del servidor no contiene una configuración válida.",
    );
  return {
    minimumPaymentPercent: minimumPaymentPercent as number,
    auxiliaryDiscountPercent: auxiliaryDiscountPercent as number,
    revision: revision as number,
  };
}

function enhance(form: HTMLFormElement): void {
  if (form.dataset.enhanced === "true") return;
  form.dataset.enhanced = "true";
  form.noValidate = true;

  let baseline = JSON.parse(
    form.dataset.baseline ?? "{}",
  ) as Partial<RegistrationSettingsFormValues>;
  const submit = form.querySelector<HTMLButtonElement>("[data-inline-save]");
  const formError = form.querySelector<HTMLElement>("[data-form-error]");
  const refresh = form.querySelector<HTMLAnchorElement>(
    "[data-settings-refresh]",
  );
  let staleConflict = refresh ? !refresh.hidden : false;
  const fields = ["minimumPaymentPercent", "auxiliaryDiscountPercent"] as const;
  const requestKey = form.elements.namedItem("requestKey") as HTMLInputElement;
  const submissionGuard = createRequestState(
    requestKey.value,
    () => crypto.randomUUID(),
    form.dataset.lastSubmitted
      ? requestFingerprint(
          JSON.parse(form.dataset.lastSubmitted) as Record<string, string>,
        )
      : undefined,
  );

  const state = () => {
    const input: Partial<Record<(typeof fields)[number], string>> = {};
    for (const name of fields) {
      const element = form.elements.namedItem(name);
      if (element instanceof HTMLInputElement) input[name] = element.value;
    }
    return registrationSettingsFormState(
      input as RegistrationSettingsFormInput,
      baseline as RegistrationSettingsFormValues,
    );
  };

  const validate = (): boolean => {
    const currentState = state();
    let firstInvalid: HTMLInputElement | undefined;
    for (const name of fields) {
      const input = form.elements.namedItem(name);
      const message = form.querySelector<HTMLElement>(
        `[data-field-error="${name}"]`,
      );
      if (!(input instanceof HTMLInputElement) || !message) continue;
      const error = currentState.errors[name] ?? "";
      message.textContent = error;
      input.setAttribute("aria-invalid", String(Boolean(error)));
      if (error && !firstInvalid) firstInvalid = input;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }
    return true;
  };

  const updateButton = (validateFields = false): void => {
    const currentState = state();
    for (const name of fields) {
      if (!validateFields) continue;
      const message = form.querySelector<HTMLElement>(
        `[data-field-error="${name}"]`,
      );
      if (message) message.textContent = currentState.errors[name] ?? "";
      const input = form.elements.namedItem(name);
      if (input instanceof HTMLInputElement)
        input.setAttribute(
          "aria-invalid",
          String(Boolean(currentState.errors[name])),
        );
    }
    if (submit)
      submit.disabled =
        !currentState.canSubmit ||
        staleConflict ||
        Boolean(
          document.querySelector(
            "[data-registration-settings-form][data-pending]",
          ),
        );
  };

  form.addEventListener("input", (event) => {
    updateButton(event.target instanceof HTMLInputElement);
  });
  form.addEventListener("submit", (event) => {
    if (!validate()) {
      event.preventDefault();
      return;
    }
    if (!state().canSubmit) {
      event.preventDefault();
      if (formError) {
        formError.textContent = "No hay cambios para guardar.";
        formError.removeAttribute("hidden");
      }
      return;
    }
    const values = Object.fromEntries(
      [...new FormData(form)].map(([name, value]) => [name, String(value)]),
    );
    if (
      staleConflict ||
      document.querySelector("[data-registration-settings-form][data-pending]")
    ) {
      event.preventDefault();
      return;
    }
    const key = submissionGuard.begin(requestFingerprint(values));
    if (!key) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    requestKey.value = key;
    values.requestKey = key;
    form.dataset.pending = "true";
    form.setAttribute("aria-busy", "true");
    document
      .querySelectorAll<HTMLFormElement>("[data-registration-settings-form]")
      .forEach((peer) => peer.dispatchEvent(new Event("input")));
    const controls = [
      ...form.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        "input,button",
      ),
    ];
    const disabled = controls.map((control) => control.disabled);
    controls.forEach((control) => {
      control.disabled = true;
    });
    const originalLabel = submit?.textContent ?? "Guardar configuración";
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Guardando…";
      submit.setAttribute("aria-busy", "true");
    }
    formError?.setAttribute("hidden", "");
    for (const name of fields) {
      const message = form.querySelector<HTMLElement>(
        `[data-field-error="${name}"]`,
      );
      if (message) message.textContent = "";
    }
    void (async () => {
      try {
        const settings = await notifications.promise(
          () => saveSettings(form, values),
          {
            id: `settings-${crypto.randomUUID()}`,
            loading: { title: "Guardando configuración…" },
            success: { title: "Configuración guardada." },
            error: (failure) => ({
              title:
                failure instanceof SettingsRequestError
                  ? failure.message
                  : "No se pudo guardar la configuración. Inténtalo nuevamente.",
            }),
          },
        );
        document
          .querySelectorAll<HTMLFormElement>(
            "[data-registration-settings-form]",
          )
          .forEach((peer) => {
            peer.dataset.baseline = JSON.stringify(settings);
            const revision = peer.elements.namedItem("revision");
            if (revision instanceof HTMLInputElement)
              revision.value = String(settings.revision);
            for (const name of fields) {
              const input = peer.elements.namedItem(name);
              if (input instanceof HTMLInputElement) {
                const dirty = input.value !== input.defaultValue;
                input.defaultValue = String(settings[name]);
                if (peer === form || input.type === "hidden" || !dirty)
                  input.value = String(settings[name]);
              }
            }
            const display = peer.querySelector<HTMLElement>(
              "[data-inline-value]",
            );
            const field = peer.dataset.editField as (typeof fields)[number];
            if (display) display.textContent = `${settings[field]} %`;
            peer.dispatchEvent(new Event("registration:baseline"));
          });
        if (formError) {
          formError.textContent = "";
          formError.hidden = false;
        }
        form.dispatchEvent(new Event("registration:saved"));
        updateButton();
      } catch (failure) {
        const requestError =
          failure instanceof SettingsRequestError
            ? failure
            : new SettingsRequestError(
                "No se pudo guardar la configuración. Inténtalo nuevamente.",
              );
        if (requestError.code === "CONCURRENT_UPDATE") {
          staleConflict = true;
          refresh?.removeAttribute("hidden");
        }
        for (const name of fields) {
          const message = form.querySelector<HTMLElement>(
            `[data-field-error="${name}"]`,
          );
          const input = form.elements.namedItem(name);
          const error = requestError.fields[name] ?? "";
          if (message) message.textContent = error;
          if (input instanceof HTMLInputElement)
            input.setAttribute("aria-invalid", String(Boolean(error)));
        }
        if (formError) {
          formError.textContent = requestError.message;
          formError.removeAttribute("hidden");
        }
        const firstInvalid = fields
          .map((name) => form.elements.namedItem(name))
          .find(
            (input) =>
              input instanceof HTMLInputElement &&
              requestError.fields[input.name],
          );
        if (firstInvalid instanceof HTMLInputElement) firstInvalid.focus();
      } finally {
        submissionGuard.finish();
        delete form.dataset.pending;
        form.removeAttribute("aria-busy");
        controls.forEach((control, index) => {
          control.disabled = disabled[index]!;
        });
        if (submit) {
          submit.textContent = originalLabel;
          submit.removeAttribute("aria-busy");
        }
        if (form.querySelector("[data-inline-editor][hidden]"))
          form.querySelector<HTMLElement>("[data-inline-edit]")?.focus();
        updateButton();
        document
          .querySelectorAll<HTMLFormElement>(
            "[data-registration-settings-form]",
          )
          .forEach((peer) => peer.dispatchEvent(new Event("input")));
      }
    })();
  });
  form.addEventListener("registration:baseline", () => {
    baseline = JSON.parse(
      form.dataset.baseline!,
    ) as RegistrationSettingsFormValues;
  });
  updateButton();
}

function initialize(): void {
  document
    .querySelectorAll<HTMLFormElement>("[data-registration-settings-form]")
    .forEach(enhance);
}

initialize();
document.addEventListener("astro:page-load", initialize);
