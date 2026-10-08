import { notifications } from "@/lib/notifications";
import { postAdminAccount } from "./request";

function initialize() {
  document
    .querySelectorAll<HTMLFormElement>("[data-admin-name]")
    .forEach((form) => {
      if (form.dataset.bound) return;
      form.dataset.bound = "true";
      const page = form.closest<HTMLElement>("[data-admin-account-details]")!;
      const input = form.querySelector<HTMLInputElement>('[name="name"]')!;
      const save = form.querySelector<HTMLButtonElement>("[data-inline-save]")!;
      const cancel = form.querySelector<HTMLButtonElement>(
        "[data-inline-cancel]",
      )!;
      const edit = form.querySelector<HTMLButtonElement>("[data-inline-edit]")!;
      const fieldError = form.querySelector<HTMLElement>("[data-field-error]")!;
      const error = form.querySelector<HTMLElement>("[data-form-error]")!;
      const refresh = form.querySelector<HTMLElement>("[data-admin-refresh]")!;
      const valid = () => input.validity.valid && Boolean(input.value.trim());
      const sync = () => {
        const pending = Boolean(page.dataset.pending);
        input.disabled = pending;
        cancel.disabled = pending;
        edit.disabled = pending;
        save.disabled =
          pending ||
          !valid() ||
          input.value.trim() === input.defaultValue.trim();
      };
      page.addEventListener("admin-account:pending", sync);
      form.addEventListener("input", () => {
        input.setAttribute("aria-invalid", "false");
        fieldError.textContent = "";
        sync();
      });
      sync();
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (page.dataset.pending || !valid() || save.disabled) return;
        const body = new URLSearchParams(
          [...new FormData(form)].map(([key, value]) => [key, String(value)]),
        );
        page.dataset.pending = "true";
        form.setAttribute("aria-busy", "true");
        page.dispatchEvent(new Event("admin-account:pending"));
        fieldError.textContent = "";
        error.textContent = "";
        refresh.hidden = true;
        const id = crypto.randomUUID();
        notifications.loading({ id, title: "Guardando nombre…" });
        let success = false;
        try {
          const result = await postAdminAccount(form.action, body);
          if (!result.ok) {
            fieldError.textContent = result.issues.name ?? "";
            input.setAttribute(
              "aria-invalid",
              String(Boolean(fieldError.textContent)),
            );
            if (!fieldError.textContent) error.textContent = result.message;
            refresh.hidden = false;
          } else if (result.value.account) {
            const account = result.value.account;
            page
              .querySelectorAll<HTMLInputElement>('[name="revision"]')
              .forEach((node) => {
                node.value = account.revision;
              });
            input.defaultValue = account.name;
            input.value = account.name;
            form.dataset.baseline = JSON.stringify({ name: account.name });
            form.querySelector<HTMLElement>(
              "[data-inline-value]",
            )!.textContent = account.name;
            page.querySelector<HTMLElement>(
              "[data-account-name]",
            )!.textContent = account.name;
            if (page.dataset.actorId === account.id) {
              document
                .querySelectorAll<HTMLElement>(
                  ".private-account .private-account-text > :first-child",
                )
                .forEach((node) => {
                  node.textContent = account.name;
                });
              document.querySelector<HTMLElement>(
                ".private-account .private-avatar",
              )!.textContent = account.name.charAt(0).toUpperCase();
            }
            page.dispatchEvent(
              new CustomEvent("admin-account:updated", { detail: account }),
            );
            form.dispatchEvent(new Event("registration:saved"));
            notifications.success({ id, title: result.message });
            success = true;
          } else throw new Error("Account missing");
        } catch {
          error.textContent =
            "No pudimos confirmar el cambio. Recarga la cuenta antes de reintentar.";
          refresh.hidden = false;
        } finally {
          delete page.dataset.pending;
          form.removeAttribute("aria-busy");
          page.dispatchEvent(new Event("admin-account:pending"));
          if (!success) notifications.dismiss(id);
          if (fieldError.textContent) input.focus();
          else if (error.textContent) error.focus();
          else edit.focus();
        }
      });
    });
}
initialize();
document.addEventListener("astro:page-load", initialize);
