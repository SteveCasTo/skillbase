import {
  createPendingSubmitGuard,
  registrationSettingsFormState,
  type RegistrationSettingsFormInput,
  type RegistrationSettingsFormValues,
} from "./registration-settings-form-state";
import { notifications } from "@/lib/notifications";

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

async function saveSettings(form: HTMLFormElement): Promise<SettingsResult> {
  const body = new URLSearchParams();
  new FormData(form).forEach((value, key) => body.append(key, String(value)));
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
  const submit = form.querySelector<HTMLButtonElement>(
    "[data-settings-submit]",
  );
  const formError = form.querySelector<HTMLElement>("[data-form-error]");
  const refresh = form.querySelector<HTMLAnchorElement>(
    "[data-settings-refresh]",
  );
  let staleConflict = refresh ? !refresh.hidden : false;
  const fields = ["minimumPaymentPercent", "auxiliaryDiscountPercent"] as const;
  const submissionGuard = createPendingSubmitGuard();

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

  const updateButton = (): void => {
    const currentState = state();
    for (const name of fields) {
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
    if (submit) submit.disabled = !currentState.canSubmit || staleConflict;
  };

  form.addEventListener("input", () => {
    formError?.setAttribute("hidden", "");
    updateButton();
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
    if (!submissionGuard.begin()) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
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
        const settings = await notifications.promise(() => saveSettings(form), {
          loading: { title: "Guardando configuración…" },
          success: { title: "Configuración guardada." },
          error: (failure) => ({
            title:
              failure instanceof SettingsRequestError
                ? failure.message
                : "No se pudo guardar la configuración. Inténtalo nuevamente.",
          }),
        });
        const minimumPayment = form.elements.namedItem("minimumPaymentPercent");
        const auxiliaryDiscount = form.elements.namedItem(
          "auxiliaryDiscountPercent",
        );
        const revision = form.elements.namedItem("revision");
        const requestKey = form.elements.namedItem("requestKey");
        if (
          minimumPayment instanceof HTMLInputElement &&
          auxiliaryDiscount instanceof HTMLInputElement &&
          revision instanceof HTMLInputElement &&
          requestKey instanceof HTMLInputElement
        ) {
          minimumPayment.value = String(settings.minimumPaymentPercent);
          auxiliaryDiscount.value = String(settings.auxiliaryDiscountPercent);
          revision.value = String(settings.revision);
          requestKey.value = crypto.randomUUID();
          baseline = {
            minimumPaymentPercent: settings.minimumPaymentPercent,
            auxiliaryDiscountPercent: settings.auxiliaryDiscountPercent,
          };
          form.dataset.baseline = JSON.stringify(baseline);
        }
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
        submissionGuard.reset();
        if (submit) {
          submit.textContent = originalLabel;
          submit.removeAttribute("aria-busy");
        }
        updateButton();
      }
    })();
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
