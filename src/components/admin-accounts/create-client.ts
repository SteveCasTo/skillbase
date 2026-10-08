import { navigate } from "astro:transitions/client";
import { notifications } from "@/lib/notifications";
import { adminCreateEligible } from "./presentation";
import { postAdminAccount } from "./request";

function initialize() {
  document
    .querySelectorAll<HTMLFormElement>("[data-admin-create]")
    .forEach((form) => {
      if (form.dataset.bound) return;
      form.dataset.bound = "true";
      const inputs = [...form.querySelectorAll<HTMLInputElement>("input")];
      const submit = form.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;
      const password =
        form.querySelector<HTMLInputElement>('[name="password"]')!;
      const toggle = form.querySelector<HTMLButtonElement>(
        "[data-password-toggle]",
      )!;
      const alert = form.querySelector<HTMLElement>("[data-form-error]")!;
      const fieldsets = [
        ...form.querySelectorAll<HTMLFieldSetElement>("fieldset"),
      ];
      const eligible = () =>
        adminCreateEligible(
          Object.fromEntries(inputs.map((input) => [input.name, input.value])),
        ) && inputs.every((input) => input.validity.valid);
      const sync = () => {
        submit.disabled = Boolean(form.dataset.pending) || !eligible();
      };
      const mark = (input: HTMLInputElement, message: string) => {
        input.setAttribute("aria-invalid", String(Boolean(message)));
        input
          .closest("[data-invalid]")
          ?.setAttribute("data-invalid", String(Boolean(message)));
        form.querySelector<HTMLElement>(
          `[data-field-error="${input.name}"]`,
        )!.textContent = message;
      };
      inputs.forEach((input) => {
        input.addEventListener("input", () => {
          mark(input, "");
          sync();
        });
        input.addEventListener("blur", () => {
          if (
            !input.validity.valid ||
            (input.name === "name" && !input.value.trim())
          )
            mark(input, "Revisa este campo.");
        });
      });
      const hidePassword = () => {
        password.type = "password";
        toggle.setAttribute("aria-pressed", "false");
        toggle.setAttribute("aria-label", "Mostrar contraseña inicial");
        toggle.querySelector<SVGElement>(
          "[data-password-show]",
        )!.style.display = "";
        toggle.querySelector<HTMLElement>("[data-password-hide]")!.hidden =
          true;
      };
      toggle.hidden = false;
      toggle.addEventListener("click", () => {
        if (password.type === "text") return hidePassword();
        password.type = "text";
        toggle.setAttribute("aria-pressed", "true");
        toggle.setAttribute("aria-label", "Ocultar contraseña inicial");
        toggle.querySelector<SVGElement>(
          "[data-password-show]",
        )!.style.display = "none";
        toggle.querySelector<HTMLElement>("[data-password-hide]")!.hidden =
          false;
      });
      sync();
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (form.dataset.pending || !eligible()) return;
        const body = new URLSearchParams(
          [...new FormData(form)].map(([key, value]) => [key, String(value)]),
        );
        form.dataset.pending = "true";
        form.setAttribute("aria-busy", "true");
        fieldsets.forEach((fieldset) => {
          fieldset.disabled = true;
        });
        sync();
        inputs.forEach((input) => mark(input, ""));
        alert.textContent = "";
        const id = crypto.randomUUID();
        notifications.loading({ id, title: "Creando administrador…" });
        let success = false;
        try {
          const result = await postAdminAccount(form.action, body);
          if (!result.ok) {
            inputs.forEach((input) =>
              mark(input, result.issues[input.name] ?? ""),
            );
            if (!Object.keys(result.issues).length)
              alert.textContent = result.message;
          } else if (result.value.account) {
            success = true;
            notifications.success({ id, title: result.message });
            password.value = "";
            await navigate(
              `/app/administradores/${result.value.account.id}?success=saved`,
            );
          } else
            throw new Error(
              "No pudimos confirmar la cuenta. Recarga antes de reintentar.",
            );
        } catch {
          alert.textContent =
            "No pudimos confirmar la cuenta. Recarga antes de reintentar.";
        } finally {
          body.delete("password");
          password.value = "";
          hidePassword();
          delete form.dataset.pending;
          form.removeAttribute("aria-busy");
          fieldsets.forEach((fieldset) => {
            fieldset.disabled = false;
          });
          sync();
          if (!success) {
            notifications.dismiss(id);
            const hint = form.querySelector<HTMLElement>(
              '[data-field-error="password"]',
            )!;
            if (!hint.textContent)
              hint.textContent =
                "Vuelve a introducir la contraseña inicial para reintentar.";
            if (alert.textContent) alert.focus();
            else
              (
                inputs.find(
                  (input) => input.getAttribute("aria-invalid") === "true",
                ) ?? password
              ).focus();
          }
        }
      });
    });
}
initialize();
document.addEventListener("astro:page-load", initialize);
