import {
  createPendingSubmitGuard,
  registrationSettingsFormState,
  type RegistrationSettingsFormInput,
  type RegistrationSettingsFormValues,
} from "./registration-settings-form-state";

function enhance(form: HTMLFormElement): void {
  if (form.dataset.enhanced === "true") return;
  form.dataset.enhanced = "true";
  form.noValidate = true;

  const baseline = JSON.parse(
    form.dataset.baseline ?? "{}",
  ) as Partial<RegistrationSettingsFormValues>;
  const submit = form.querySelector<HTMLButtonElement>(
    "[data-settings-submit]",
  );
  const formError = form.querySelector<HTMLElement>("[data-form-error]");
  const fields = ["minimumPaymentPercent", "auxiliaryDiscountPercent"] as const;
  const allowSubmission = createPendingSubmitGuard();

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
    if (submit) submit.disabled = !currentState.canSubmit;
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
    if (!allowSubmission()) {
      event.preventDefault();
      return;
    }
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Guardando…";
      submit.setAttribute("aria-busy", "true");
    }
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
