import { notifications } from "@/lib/notifications";
import {
  certificateSettingsValue,
  type CertificateSettingsField,
} from "@/application/certificates/update-settings-field";
import type { CertificateConfiguration } from "@/domain/certificates/types";

function initialize() {
  const forms = [
    ...document.querySelectorAll<HTMLFormElement>(
      "[data-certificate-settings-field]",
    ),
  ];
  for (const form of forms) {
    if (form.dataset.enhanced) continue;
    form.dataset.enhanced = "true";
    form.noValidate = true;
    const input = form.elements.namedItem("value") as HTMLInputElement;
    const error = form.querySelector<HTMLElement>("[data-field-error]")!;
    const general = form.querySelector<HTMLElement>("[data-form-error]")!;
    const refresh = form.querySelector<HTMLElement>("[data-settings-refresh]")!;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (forms.some((peer) => peer.dataset.pending)) return;
      if (!input.checkValidity()) {
        error.textContent = input.validationMessage;
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      if (input.value === input.defaultValue) {
        form.dispatchEvent(new Event("registration:saved"));
        return;
      }
      const body = new URLSearchParams(
        [...new FormData(form)].map(([key, value]) => [key, String(value)]),
      );
      const controls = forms.flatMap((peer) => [
        ...peer.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
          "input, button",
        ),
      ]);
      const disabled = controls.map((control) => control.disabled);
      form.dataset.pending = "true";
      form.setAttribute("aria-busy", "true");
      controls.forEach((control) => {
        control.disabled = true;
      });
      error.textContent = "";
      general.textContent = "";
      const id = `certificate-settings-${crypto.randomUUID()}`;
      notifications.loading({ id, title: "Guardando configuración…" });
      let saved = false;
      try {
        const response = await fetch(form.action, {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          body,
        });
        const payload = (await response.json()) as {
          ok: boolean;
          code?: string;
          message: string;
          issues?: Record<string, string>;
          value?: { revision: number; configuration: CertificateConfiguration };
        };
        if (!response.ok || !payload.ok || !payload.value) {
          const fieldError = payload.issues?.[form.dataset.editField!];
          error.textContent = fieldError ?? "";
          general.textContent = fieldError ? "" : payload.message;
          input.setAttribute("aria-invalid", String(Boolean(fieldError)));
          if (payload.code === "CONCURRENT_UPDATE") refresh.hidden = false;
          notifications.dismiss(id);
          return;
        }
        for (const peer of forms) {
          const value = certificateSettingsValue(
            payload.value.configuration,
            peer.dataset.editField as CertificateSettingsField,
          );
          const control = peer.elements.namedItem("value") as HTMLInputElement;
          const dirty = control.value !== control.defaultValue;
          control.defaultValue = value;
          if (peer === form || !dirty) control.value = value;
          (peer.elements.namedItem("revision") as HTMLInputElement).value =
            String(payload.value.revision);
          peer.dataset.baseline = JSON.stringify({ value });
          peer.querySelector<HTMLElement>("[data-inline-value]")!.textContent =
            value || "Pendiente";
        }
        input.setAttribute("aria-invalid", "false");
        refresh.hidden = true;
        form.dispatchEvent(new Event("registration:saved"));
        notifications.success({ id, title: "Configuración guardada." });
        saved = true;
      } catch {
        general.textContent =
          "No se pudo confirmar el guardado. Recarga los valores vigentes antes de reintentar.";
        refresh.hidden = false;
        notifications.dismiss(id);
      } finally {
        delete form.dataset.pending;
        form.removeAttribute("aria-busy");
        controls.forEach((control, index) => {
          control.disabled = disabled[index]!;
        });
        if (saved)
          form.querySelector<HTMLElement>("[data-inline-edit]")?.focus();
        else input.focus();
      }
    });
  }
}
initialize();
document.addEventListener("astro:page-load", initialize);
