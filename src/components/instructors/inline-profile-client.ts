import { notifications } from "@/lib/notifications";
import { bindPhoneInputs } from "@/components/pre-registrations/participant-fields";

function initialize() {
  bindPhoneInputs();
  document
    .querySelectorAll<HTMLFormElement>("[data-instructor-field]")
    .forEach((form) => {
      if (form.dataset.bound) return;
      form.dataset.bound = "true";
      const input = form.querySelector<HTMLInputElement>(
        "input:not([type=hidden])",
      )!;
      const save = form.querySelector<HTMLButtonElement>("[data-inline-save]")!;
      const cancel = form.querySelector<HTMLButtonElement>(
        "[data-inline-cancel]",
      )!;
      const edit = form.querySelector<HTMLButtonElement>("[data-inline-edit]")!;
      const fieldError = form.querySelector<HTMLElement>("[data-field-error]")!;
      const error = form.querySelector<HTMLElement>("[data-form-error]")!;
      const details = form.closest<HTMLElement>("[data-instructor-details]")!;
      const valid = () =>
        input.validity.valid &&
        (!input.required || Boolean(input.value.trim()));
      const sync = () => {
        save.disabled =
          Boolean(details.dataset.pending) ||
          !valid() ||
          input.value.trim() === input.defaultValue.trim();
      };
      form.addEventListener("input", () => {
        input.setAttribute("aria-invalid", "false");
        fieldError.textContent = "";
        sync();
      });
      input.addEventListener("blur", () => {
        if (input.disabled || valid()) return;
        fieldError.textContent =
          input.required && !input.value.trim()
            ? "Completa este campo."
            : "Revisa el valor de este campo.";
        input.setAttribute("aria-invalid", "true");
      });
      form.addEventListener("profile:pending", () => {
        const pending = Boolean(details.dataset.pending);
        input.disabled = pending;
        cancel.disabled = pending;
        edit.disabled = pending;
        sync();
      });
      sync();
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (details.dataset.pending || !valid() || save.disabled) return;
        const data = new URLSearchParams();
        new FormData(form).forEach((value, key) => {
          if (typeof value === "string") data.set(key, value);
        });
        details.dataset.pending = "true";
        form.setAttribute("aria-busy", "true");
        const forms = details.querySelectorAll<HTMLFormElement>("form");
        forms.forEach((item) =>
          item.dispatchEvent(new Event("profile:pending")),
        );
        error.textContent = "";
        fieldError.textContent = "";
        const id = crypto.randomUUID();
        notifications.loading({ id, title: "Guardando perfil…" });
        let failureMessage = "";
        try {
          const response = await fetch(form.action, {
            method: "POST",
            headers: { Accept: "application/json" },
            body: data,
          });
          const result: {
            revision?: string;
            values?: Record<string, string>;
            error?: string;
            fieldErrors?: Record<string, string>;
          } = await response.json();
          if (!response.ok || !result.revision || !result.values) {
            const message =
              result.fieldErrors?.[input.name] ??
              result.error ??
              "No se pudo guardar. Inténtalo nuevamente.";
            if (result.fieldErrors?.[input.name]) {
              fieldError.textContent = message;
              input.setAttribute("aria-invalid", "true");
            } else error.textContent = message;
            failureMessage = message;
            throw new Error(message);
          }
          // Advance every field and the lifecycle's optimistic token without
          // replacing other open editors or their unsaved input.
          const page = details.closest("[data-private-page]") ?? details;
          page
            .querySelectorAll<HTMLInputElement>('input[name="revision"]')
            .forEach((node) => {
              node.value = result.revision!;
            });
          forms.forEach((item) => {
            item.dataset.baseline = JSON.stringify(result.values);
            const control = item.querySelector<HTMLInputElement>(
              "input:not([type=hidden])",
            )!;
            control.defaultValue = result.values![control.name] ?? "";
            const value = item.querySelector<HTMLElement>(
              "[data-inline-value]",
            )!;
            value.textContent = control.defaultValue || "No indicado";
          });
          input.value = input.defaultValue;
          input.setAttribute("aria-invalid", "false");
          form.dispatchEvent(new Event("registration:saved"));
          notifications.success({ id, title: "Perfil actualizado" });
        } catch {
          const message =
            failureMessage ||
            "No se pudo guardar. Revisa tu conexión e inténtalo nuevamente.";
          if (!fieldError.textContent) error.textContent = message;
          notifications.dismiss(id);
        } finally {
          delete details.dataset.pending;
          form.removeAttribute("aria-busy");
          forms.forEach((item) =>
            item.dispatchEvent(new Event("profile:pending")),
          );
          if (fieldError.textContent) input.focus();
          else if (error.textContent) error.focus();
          else edit.focus();
        }
      });
    });
}
initialize();
document.addEventListener("astro:page-load", initialize);
