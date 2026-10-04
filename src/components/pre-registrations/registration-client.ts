import type { RegistrationFormDto } from "@/domain/pre-registrations/types";
import {
  formatMoney,
  pricePreview,
  registrationFormState,
  registrationWindow,
  moneyFieldIssues,
} from "./presentation";
import { createRequestState } from "./request-state";
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
    onSuccess: (value: T) => void;
    successMessage: string;
  },
) {
  const keyInput = form.elements.namedItem("requestKey");
  if (!(keyInput instanceof HTMLInputElement))
    throw new Error("Missing requestKey");
  const state = createRequestState(keyInput.value, () => crypto.randomUUID());
  const handler = async (event: SubmitEvent) => {
    // Validation listener cancels invalid submissions first.
    if (event.defaultPrevented) return;
    event.preventDefault();
    const values = readFormValues(form);
    const payload = { ...values };
    delete payload.requestKey;
    const key = state.begin(JSON.stringify(payload));
    if (!key) return;
    keyInput.value = key;
    form.dataset.pending = "true";
    form.setAttribute("aria-busy", "true");
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
      'button[type="submit"]',
    );
    const label = button?.textContent ?? "Guardar";
    if (button) button.textContent = "Registrando…";
    const toastId = `registration-${crypto.randomUUID()}`;
    notifications.loading({ id: toastId, title: "Registrando…" });
    try {
      const result = await adapter.submit({ ...values, requestKey: key });
      if (result.ok) {
        adapter.onSuccess(result.value);
        notifications.success({ id: toastId, title: adapter.successMessage });
      } else {
        showFormIssues(form, { ...result.issues, form: result.message });
        notifications.error({
          id: toastId,
          title: "No se pudo registrar",
          description: result.message,
        });
      }
    } catch {
      showFormIssues(form, {
        form: "No se pudo confirmar el registro. Conservamos tus datos; reintenta para comprobar el mismo movimiento.",
      });
      notifications.error({
        id: toastId,
        title: "Sin confirmación",
        description: "Reintenta sin cambiar los datos.",
      });
    } finally {
      state.finish();
      delete form.dataset.pending;
      form.removeAttribute("aria-busy");
      controls.forEach((control, index) => {
        control.disabled = previous[index]!;
      });
      if (button) button.textContent = label;
      form.dispatchEvent(new Event("registration:updated"));
      const firstError = form.querySelector<HTMLElement>(
        '[aria-invalid="true"]:not([hidden])',
      );
      (firstError ?? button)?.focus();
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
      const update = (all = false) => {
        const values = readFormValues(form);
        const cash =
          form.querySelector<HTMLFieldSetElement>("[data-cash-fields]");
        try {
          const price = pricePreview(
            dto,
            values.participantType as Parameters<typeof pricePreview>[1],
          );
          const free = price.totalPriceCents === 0;
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
          if (discount)
            discount.textContent = price.discountPercent
              ? `Descuento auxiliar: ${price.discountPercent} % sobre tarifa estudiante.`
              : "Sin descuento aplicado.";
        } catch {
          /* Invalid raw selection is reported by domain validation below. */
        }
        const state = registrationFormState(
          dto,
          readFormValues(form),
          serverNow,
        );
        showFormIssues(form, state.issues, all ? undefined : touched);
        const button = form.querySelector<HTMLButtonElement>(
          'button[type="submit"]',
        );
        if (button)
          button.disabled = Boolean(form.dataset.pending) || !state.valid;
        return state.valid;
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
      form.addEventListener("registration:updated", () => update());
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
