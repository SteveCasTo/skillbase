import type { RegistrationFormDto } from "@/domain/pre-registrations/types";
import {
  formatMoney,
  pricePreview,
  registrationFormState,
  registrationWindow,
  moneyFieldIssues,
} from "./presentation";
import { createRequestState, requestFingerprint } from "./request-state";
import { notifications } from "@/lib/notifications";
import { bindMoneyInput } from "./money-input";

export function readFormValues(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    [...new FormData(form)].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
export function showFormIssues(
  form: HTMLFormElement,
  issues: Readonly<Record<string, string>>,
  touched?: ReadonlySet<string>,
) {
  const fieldIssues = moneyFieldIssues(issues);
  form.querySelectorAll<HTMLElement>("[data-field-error]").forEach((error) => {
    const name = error.dataset.fieldError!;
    if (touched && !touched.has(name)) return;
    const message = fieldIssues[name] ?? "";
    error.textContent = message;
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLElement)
      control.setAttribute("aria-invalid", String(Boolean(message)));
    error
      .closest("[data-invalid]")
      ?.setAttribute("data-invalid", String(Boolean(message)));
    const trigger = form.querySelector<HTMLElement>(
      `[aria-describedby="${error.id}"][data-slot="select-trigger"]`,
    );
    trigger?.setAttribute("aria-invalid", String(Boolean(message)));
  });
  const alert = form.querySelector<HTMLElement>("[data-form-error]");
  if (alert && !touched) alert.textContent = issues.form ?? "";
}
export type SubmitResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; issues: Readonly<Record<string, string>> };
/** Explicit adapter: no endpoint or response contract is fabricated by components. */
export function bindRegistrationMutation<T>(
  form: HTMLFormElement,
  adapter: {
    submit: (
      values: Readonly<Record<string, string>>,
    ) => Promise<SubmitResult<T>>;
    onSuccess: (value: T) => void | Promise<void>;
    successMessage: string;
  },
) {
  const keyInput = form.elements.namedItem("requestKey");
  if (!(keyInput instanceof HTMLInputElement))
    throw new Error("Missing requestKey");
  const state = createRequestState(
    keyInput.value,
    () => crypto.randomUUID(),
    form.dataset.lastSubmitted
      ? requestFingerprint(
          JSON.parse(form.dataset.lastSubmitted) as Record<string, string>,
        )
      : undefined,
  );
  const handler = async (event: SubmitEvent) => {
    // Validation listener cancels invalid submissions first.
    if (event.defaultPrevented) return;
    event.preventDefault();
    const values = readFormValues(form);
    const key = state.begin(requestFingerprint(values));
    if (!key) return;
    keyInput.value = key;
    form.dataset.pending = "true";
    form.setAttribute("aria-busy", "true");
    if (form.hasAttribute("data-participant-edit"))
      document
        .querySelectorAll<HTMLFormElement>("[data-participant-edit]")
        .forEach((peer) =>
          peer.dispatchEvent(new Event("registration:updated")),
        );
    const controls = [
      ...form.querySelectorAll<
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLButtonElement
        | HTMLFieldSetElement
      >("input, select, button, fieldset"),
    ];
    const previous = controls.map((control) => control.disabled);
    controls.forEach((control) => {
      control.disabled = true;
    });
    const button = form.querySelector<HTMLButtonElement>(
      'button[type="submit"], button[data-cancel-trigger]',
    );
    // Do not replace the button's children: inline saves contain a persistent SVG.
    button?.setAttribute("aria-busy", "true");
    const registering = form.hasAttribute("data-registration-form");
    const toastId = `registration-${crypto.randomUUID()}`;
    notifications.loading({
      id: toastId,
      title: registering ? "Registrando…" : "Guardando…",
    });
    try {
      const result = await adapter.submit({ ...values, requestKey: key });
      if (result.ok) {
        await adapter.onSuccess(result.value);
        notifications.success({ id: toastId, title: adapter.successMessage });
        form.dispatchEvent(new Event("registration:saved"));
      } else {
        const fieldIssues = moneyFieldIssues(result.issues);
        const hasFieldIssues = [
          ...form.querySelectorAll<HTMLElement>("[data-field-error]"),
        ].some((error) => Boolean(fieldIssues[error.dataset.fieldError ?? ""]));
        showFormIssues(
          form,
          hasFieldIssues
            ? result.issues
            : { ...result.issues, form: result.message },
        );
        if (hasFieldIssues || form.querySelector("[data-inline-field]"))
          notifications.dismiss(toastId);
        else {
          const alert = form.querySelector<HTMLElement>("[data-form-error]");
          if (alert) alert.textContent = "";
          notifications.error({
            id: toastId,
            title: registering ? "No se pudo registrar" : "No se pudo guardar",
            description: result.message,
          });
        }
      }
    } catch {
      showFormIssues(form, {
        form: "No se pudo confirmar el registro. Conservamos tus datos; reintenta para comprobar el mismo movimiento.",
      });
      const alert = form.querySelector<HTMLElement>("[data-form-error]");
      if (alert && form.querySelector("[data-inline-field]")) {
        alert.textContent =
          "No se pudo confirmar el guardado. Conservamos tus cambios; reintenta sin cambiar los datos.";
        notifications.dismiss(toastId);
      } else {
        if (alert) alert.textContent = "";
        notifications.error({
          id: toastId,
          title: "Sin confirmación",
          description: "Reintenta sin cambiar los datos.",
        });
      }
    } finally {
      state.finish();
      delete form.dataset.pending;
      form.removeAttribute("aria-busy");
      controls.forEach((control, index) => {
        control.disabled = previous[index]!;
      });
      button?.removeAttribute("aria-busy");
      form.dispatchEvent(new Event("registration:updated"));
      if (form.hasAttribute("data-participant-edit"))
        document
          .querySelectorAll<HTMLFormElement>("[data-participant-edit]")
          .forEach((peer) =>
            peer.dispatchEvent(new Event("registration:updated")),
          );
      const firstError = form.querySelector<HTMLElement>(
        '[aria-invalid="true"]:not([hidden]):not([type="hidden"])',
      );
      if (firstError) firstError.focus();
      else if (
        form
          .querySelector<HTMLElement>("[data-form-error]")
          ?.textContent?.trim()
      ) {
        const alert = form.querySelector<HTMLElement>("[data-form-error]")!;
        alert.tabIndex = -1;
        alert.focus();
      } else if (
        form.isConnected &&
        form.querySelector<HTMLElement>("[data-inline-editor][hidden]")
      )
        form.querySelector<HTMLElement>("[data-inline-edit]")?.focus();
      else if (form.isConnected) button?.focus();
    }
  };
  form.addEventListener("submit", handler);
  return () => form.removeEventListener("submit", handler);
}

export function initializeRegistrationForms() {
  document
    .querySelectorAll<HTMLFormElement>("[data-registration-form]")
    .forEach((form) => {
      if (form.dataset.bound) return;
      form.dataset.bound = "true";
      form.noValidate = true;
      const money = form.elements.namedItem("amount");
      if (money instanceof HTMLInputElement) bindMoneyInput(money);
      const dto = JSON.parse(
        form.dataset.configuration!,
      ) as RegistrationFormDto;
      const serverNow = form.dataset.serverNow!;
      const touched = new Set<string>();
      const update = (all = false, show = true) => {
        // Disabled controls are omitted from FormData. Do not revalidate that
        // empty snapshot while a valid submission navigates to its detail.
        if (form.dataset.pending) return false;
        const values = readFormValues(form);
        const cash =
          form.querySelector<HTMLFieldSetElement>("[data-cash-fields]");
        try {
          const price = pricePreview(
            dto,
            values.participantType as Parameters<typeof pricePreview>[1],
          );
          const free = price.totalPriceCents === 0;
          if (money instanceof HTMLInputElement)
            money.dataset.moneyMax = String(price.totalPriceCents);
          if (cash) {
            cash.disabled = free;
            cash.hidden = free;
          }
          const notice = form.querySelector<HTMLElement>("[data-free-notice]");
          if (notice) notice.hidden = !free;
          const total = form.querySelector<HTMLElement>("[data-price-total]");
          const minimum = form.querySelector<HTMLElement>(
            "[data-price-minimum]",
          );
          const discount = form.querySelector<HTMLElement>(
            "[data-price-discount]",
          );
          if (total)
            total.textContent = free
              ? "Gratuito"
              : formatMoney(price.totalPriceCents);
          if (minimum)
            minimum.textContent = free
              ? "Exento"
              : formatMoney(
                  registrationWindow(dto, serverNow).firstDay
                    ? price.totalPriceCents
                    : price.minimumPaymentCents,
                );
          if (discount) {
            discount.hidden = values.participantType !== "AUXILIARY";
            discount.textContent = `Descuento auxiliar: ${price.discountPercent} % sobre tarifa estudiante.`;
          }
        } catch {
          /* Invalid raw selection is reported by domain validation below. */
        }
        const state = registrationFormState(
          dto,
          readFormValues(form),
          serverNow,
        );
        if (show) showFormIssues(form, state.issues, all ? undefined : touched);
        const button = form.querySelector<HTMLButtonElement>(
          'button[type="submit"]',
        );
        const datesValid = [
          ...form.querySelectorAll<HTMLInputElement>("[data-civil-control]"),
        ].every((input) => input.disabled || input.validity.valid);
        if (button)
          button.disabled =
            Boolean(form.dataset.pending) || !state.valid || !datesValid;
        return state.valid && datesValid;
      };
      form.addEventListener("input", () => update());
      form.addEventListener("change", () => update());
      form.addEventListener("focusout", (event) => {
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement
        )
          touched.add(event.target.name);
        update();
      });
      form.addEventListener("registration:updated", () => update(false, false));
      form.addEventListener("submit", (event) => {
        if (form.dataset.pending || !update(true)) {
          event.preventDefault();
          form
            .querySelector<HTMLElement>('[aria-invalid="true"]:not([hidden])')
            ?.focus();
        }
      });
      update();
    });
}
