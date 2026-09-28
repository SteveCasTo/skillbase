import { navigate } from "astro:transitions/client";
import { sileo } from "sileo";
import { groupEndTime } from "./group-schedule-preview";

document.addEventListener("astro:page-load", () => {
  const error = document.querySelector<HTMLElement>("[data-group-error]");
  if (!error) return;
  document
    .querySelector<HTMLButtonElement>("[data-reload-page]")
    ?.addEventListener("click", () => location.reload());
  const messages: Record<string, string> = {
    created: "Grupo creado.",
    schedule: "Horario actualizado.",
    capacity: "Capacidad actualizada.",
    cancelled: "Grupo desactivado; su historial se conserva.",
    reactivated: "Grupo reactivado.",
    deleted: "Grupo eliminado.",
  };
  const success = new URLSearchParams(location.search).get("success");
  if (success && messages[success]) {
    sileo.success({ title: messages[success], duration: 6000 });
    history.replaceState(history.state, "", location.pathname);
  }

  const newDialog =
    document.querySelector<HTMLDialogElement>("[data-new-dialog]");
  const actionDialog = document.querySelector<HTMLDialogElement>(
    "[data-action-dialog]",
  );
  let opener: HTMLButtonElement | null = null;
  const newTrigger =
    document.querySelector<HTMLButtonElement>("[data-new-trigger]");
  if (newDialog && newTrigger) {
    document.querySelector<HTMLElement>("[data-new-fallback]")!.hidden = true;
    newTrigger.hidden = false;
    newTrigger.addEventListener("click", () => {
      opener = newTrigger;
      newDialog.showModal();
    });
  }
  for (const dialog of [newDialog, actionDialog]) {
    dialog
      ?.querySelector<HTMLButtonElement>("[data-dialog-close]")
      ?.addEventListener("click", () => dialog.close());
    dialog?.addEventListener("close", () => opener?.focus());
  }
  document
    .querySelectorAll<HTMLButtonElement>("[data-action-trigger]")
    .forEach((button) => {
      const fallback = button.parentElement?.querySelector<HTMLElement>(
        "[data-action-fallback]",
      );
      if (!actionDialog || !fallback) return;
      fallback.hidden = true;
      button.hidden = false;
      button.addEventListener("click", () => {
        opener = button;
        const source = fallback.querySelector<HTMLFormElement>("form");
        const target = actionDialog.querySelector<HTMLFormElement>("form");
        if (!source || !target) return;
        const values = new FormData(source);
        for (const name of ["intent", "groupId", "revision"])
          target.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value =
            String(values.get(name));
        const intent = button.dataset.actionTrigger;
        actionDialog.querySelector<HTMLElement>(
          "#action-dialog-title",
        )!.textContent =
          intent === "delete"
            ? "¿Eliminar grupo?"
            : intent === "cancel"
              ? "¿Desactivar grupo?"
              : "¿Reactivar grupo?";
        actionDialog.querySelector<HTMLElement>(
          "#action-dialog-description",
        )!.textContent =
          intent === "delete"
            ? "Se eliminará permanentemente. No se puede deshacer."
            : intent === "cancel"
              ? "El grupo quedará inactivo y conservará su historial."
              : "El grupo volverá a estar activo.";
        target.querySelector<HTMLButtonElement>(
          'button[type="submit"]',
        )!.textContent =
          intent === "delete"
            ? "Sí, eliminar grupo"
            : intent === "cancel"
              ? "Sí, desactivar grupo"
              : "Sí, reactivar grupo";
        actionDialog.showModal();
      });
    });

  document
    .querySelectorAll<HTMLElement>("[data-group-field]")
    .forEach((field) => {
      const trigger = field.querySelector<HTMLButtonElement>(
        "[data-edit-trigger]",
      );
      const details = field.querySelector<HTMLDetailsElement>(
        "[data-edit-fallback]",
      );
      if (!trigger || !details) return;
      const summary = details.querySelector<HTMLElement>("summary")!;
      const cancel =
        details.querySelector<HTMLButtonElement>("[data-edit-cancel]")!;
      summary.hidden = true;
      trigger.hidden = false;
      cancel.hidden = false;
      const close = () => {
        details.open = false;
        trigger.hidden = false;
        trigger.focus();
        details.querySelector<HTMLFormElement>("form")?.reset();
        details
          .querySelectorAll<HTMLElement>("[data-field-error]")
          .forEach((node) => (node.hidden = true));
        details
          .querySelectorAll<HTMLInputElement>("input[aria-invalid]")
          .forEach((node) => {
            node.removeAttribute("aria-invalid");
            node.removeAttribute("aria-describedby");
          });
      };
      trigger.addEventListener("click", () => {
        details.open = true;
        trigger.hidden = true;
        details
          .querySelector<HTMLInputElement>('input:not([type="hidden"])')
          ?.focus();
      });
      cancel.addEventListener("click", close);
    });

  document
    .querySelectorAll<HTMLFormElement>(
      "[data-group-form][data-session-minutes]",
    )
    .forEach((form) => {
      const input = form.querySelector<HTMLInputElement>('[name="startTime"]');
      const output = form.querySelector<HTMLElement>("[data-group-end]");
      if (!input || !output) return;
      const slots = JSON.parse(form.dataset.occupied ?? "[]") as {
        start: string;
        end: string;
      }[];
      const sync = () => {
        const end = groupEndTime(
          input.value,
          Number(form.dataset.sessionMinutes),
        );
        const overlaps = Boolean(
          end &&
          slots.some((slot) => input.value < slot.end && slot.start < end),
        );
        output.textContent = !input.value
          ? ""
          : !end
            ? "El grupo debe terminar el mismo día."
            : overlaps
              ? `Fin: ${end}. Este horario se solapa con otro grupo.`
              : `Fin: ${end}`;
        output.classList.toggle(
          "text-destructive",
          Boolean(input.value && (!end || overlaps)),
        );
      };
      input.addEventListener("input", sync);
      sync();
    });

  document
    .querySelectorAll<HTMLFormElement>("[data-group-form]")
    .forEach((form) =>
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const button = form.querySelector<HTMLButtonElement>(
          'button[type="submit"]',
        );
        if (!button || button.disabled) return;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        error.hidden = true;
        const intent = String(new FormData(form).get("intent"));
        form
          .querySelectorAll<HTMLElement>("[data-field-error]")
          .forEach((node) => (node.hidden = true));
        form
          .querySelectorAll<HTMLInputElement>("input[aria-invalid]")
          .forEach((node) => {
            node.removeAttribute("aria-invalid");
            node.removeAttribute("aria-describedby");
          });
        void (async () => {
          try {
            const response = await fetch(location.pathname, {
              method: "POST",
              headers: { Accept: "application/json" },
              body: new FormData(form),
            });
            if (
              response.redirected ||
              !response.headers
                .get("content-type")
                ?.includes("application/json")
            )
              throw new Error(
                "La sesión cambió. Recarga la página e inténtalo de nuevo.",
              );
            const result: unknown = await response.json();
            const details =
              result && typeof result === "object" ? result : null;
            const message =
              details &&
              "message" in details &&
              typeof details.message === "string"
                ? details.message
                : "No se pudo completar la acción.";
            const code =
              details && "code" in details && typeof details.code === "string"
                ? details.code
                : "";
            if (!response.ok) {
              if (
                (response.status === 422 || code === "SCHEDULE_CONFLICT") &&
                ["create", "schedule", "capacity"].includes(intent)
              ) {
                const target =
                  intent === "capacity" ||
                  (intent === "create" && /capacidad/i.test(message))
                    ? "capacity"
                    : "startTime";
                const field = form.querySelector<HTMLInputElement>(
                  `[name="${target}"]`,
                );
                const fieldError = form.querySelector<HTMLElement>(
                  `[data-field-error="${target}"]`,
                );
                if (field && fieldError) {
                  fieldError.textContent = message;
                  fieldError.hidden = false;
                  field.setAttribute("aria-invalid", "true");
                  field.setAttribute("aria-describedby", fieldError.id);
                  field.focus();
                  return;
                }
              }
              throw new Error(
                code === "STALE_GROUP" ? `__stale__:${message}` : message,
              );
            }
            if (
              !details ||
              !("revision" in details) ||
              typeof details.revision !== "string"
            )
              throw new Error(message);
            if (newDialog?.open) newDialog.close();
            if (actionDialog?.open) actionDialog.close();
            await navigate(
              `${location.pathname}?success=${intent === "cancel" ? "cancelled" : intent === "reactivate" ? "reactivated" : intent === "delete" ? "deleted" : intent === "create" ? "created" : intent}`,
            );
          } catch (failure) {
            if (newDialog?.open) newDialog.close();
            if (actionDialog?.open) actionDialog.close();
            const message =
              failure instanceof Error
                ? failure.message
                : "No se pudo completar la acción.";
            error.replaceChildren(
              document.createTextNode(message.replace(/^__stale__:/, "")),
            );
            if (message.startsWith("__stale__:")) {
              const reload = document.createElement("button");
              reload.type = "button";
              reload.textContent = "Recargar datos actuales";
              reload.className = "mt-2 min-h-11 underline underline-offset-4";
              reload.addEventListener("click", () => location.reload());
              error.append(reload);
            }
            error.hidden = false;
            error.tabIndex = -1;
            error.focus();
          } finally {
            button.disabled = false;
            button.removeAttribute("aria-busy");
          }
        })();
      }),
    );
});
