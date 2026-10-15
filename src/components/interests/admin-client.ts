import { notifications } from "@/lib/notifications";
import {
  isAdminMetrics,
  isAdminRegistration,
  isAdminDeletion,
  preferenceDemand,
} from "./admin-presentation";
import type { AdminInterestMetricsDto } from "@/domain/interests/types";

export function initializeAdminInterests(): void {
  document
    .querySelectorAll<HTMLElement>("[data-admin-interests]")
    .forEach((root) => {
      if (root.dataset.initialized) return;
      root.dataset.initialized = "true";
      const dialog = root.querySelector<HTMLDialogElement>(
        "[data-interest-dialog]",
      );
      if (!dialog) return;
      const locks = new Set<string>();
      // Metrics have no revision token. Apply this view's requests in order so
      // overlapping rows cannot replace a newer aggregate with an older response.
      let mutations = Promise.resolve();
      let selected: HTMLFormElement | null = null;
      let trigger: HTMLElement | null = null;
      const login = root.querySelector<HTMLElement>("[data-session-login]");
      const input = (form: HTMLFormElement, name: string) =>
        form.elements.namedItem(name) as HTMLInputElement;
      const close = () => {
        dialog.close();
        trigger?.focus({ preventScroll: true });
        selected = null;
      };
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        close();
      });
      root
        .querySelector("[data-dialog-dismiss]")
        ?.addEventListener("click", close);

      function reconcile(
        form: HTMLFormElement,
        revision: string,
        metrics: AdminInterestMetricsDto,
      ) {
        input(form, "revision").value = revision;
        const total = root.querySelector("[data-active-total]");
        if (total) total.textContent = String(metrics.activeTotal);
        const demand = preferenceDemand(metrics);
        root
          .querySelectorAll<HTMLElement>("[data-preference-id]")
          .forEach((node) => {
            const bucket = demand.find(
              (item) =>
                (item.preferredGroupId ?? "") === node.dataset.preferenceId,
            );
            if (!bucket) return;
            node.textContent = String(bucket.activeCount);
            const demandRow = node.closest<HTMLElement>("[data-demand-row]");
            if (!demandRow) return;
            demandRow.dataset.leading = String(bucket.leading);
            const bar =
              demandRow.querySelector<HTMLElement>("[data-demand-bar]");
            if (bar) bar.style.width = `${bucket.share}%`;
            const share = demandRow.querySelector("[data-demand-share]");
            if (share)
              share.textContent = `${Math.round(bucket.share)} % del total activo`;
            const leading = demandRow.querySelector<HTMLElement>(
              "[data-demand-leading]",
            );
            if (leading) leading.hidden = !bucket.leading;
          });
        const empty = root.querySelector<HTMLElement>("[data-interests-empty]");
        if (empty) empty.hidden = !!root.querySelector("[data-interest-id]");
      }

      async function mutate(form: HTMLFormElement) {
        const row = form.closest<HTMLElement>("[data-interest-id]");
        const id = row?.dataset.interestId;
        if (!row || !id || locks.has(id)) return;
        locks.add(id);
        const precedingMutation = mutations;
        let releaseMutation!: () => void;
        mutations = new Promise<void>((resolve) => {
          releaseMutation = resolve;
        });
        row.setAttribute("aria-busy", "true");
        row.querySelector("summary")?.setAttribute("aria-disabled", "true");
        form.querySelectorAll("button").forEach((button) => {
          button.disabled = true;
        });
        const rowError = row.querySelector<HTMLElement>("[data-row-error]");
        if (rowError) {
          rowError.hidden = true;
          rowError.textContent = "";
        }
        if (login) login.hidden = true;
        const notificationId = `notification-${crypto.randomUUID()}`;
        notifications.loading({
          id: notificationId,
          title: "Actualizando interesado…",
        });
        try {
          await precedingMutation;
          const values = new URLSearchParams();
          new FormData(form).forEach((value, key) => {
            if (typeof value === "string") values.set(key, value);
          });
          const response = await fetch(form.action, {
            method: "POST",
            headers: { Accept: "application/json" },
            body: values,
          });
          if (
            response.redirected ||
            response.status === 401 ||
            (response.status === 403 &&
              !response.headers
                .get("content-type")
                ?.includes("application/json"))
          ) {
            if (login) login.hidden = false;
            throw new Error(
              "La sesión ya no está disponible. Inicia sesión y vuelve a intentarlo.",
            );
          }
          if (
            !response.headers.get("content-type")?.includes("application/json")
          )
            throw new Error(
              "No pudimos confirmar el cambio. Revisa el estado antes de reintentar.",
            );
          const payload: unknown = await response.json();
          if (
            typeof payload !== "object" ||
            payload === null ||
            !("ok" in payload)
          )
            throw new Error(
              "La respuesta no es válida. Revisa el estado antes de reintentar.",
            );
          const courseId = root.dataset.courseId ?? "";
          if (response.ok && payload.ok === true) {
            if (!isAdminDeletion(payload, courseId, id))
              throw new Error(
                "La respuesta no es válida. Revisa el registro antes de reintentar.",
              );
            reconcile(form, input(form, "revision").value, payload.metrics);
            row.remove();
            root
              .querySelector<HTMLElement>("#interest-list-title")
              ?.focus({ preventScroll: true });
            const empty = root.querySelector<HTMLElement>(
              "[data-interests-empty]",
            );
            if (empty)
              empty.hidden = !!root.querySelector("[data-interest-id]");
            const announcement = root.querySelector(
              "[data-interest-announcement]",
            );
            if (announcement)
              announcement.textContent = "Interesado eliminado.";
          }
          const stale =
            response.status === 409 &&
            "code" in payload &&
            payload.code === "STALE_INTEREST_REGISTRATION";
          if (stale) {
            if (
              !("registration" in payload) ||
              !("metrics" in payload) ||
              !isAdminRegistration(payload.registration, courseId, id) ||
              !isAdminMetrics(payload.metrics, courseId)
            )
              throw new Error(
                "La respuesta no es válida. Revisa el estado antes de reintentar.",
              );
            reconcile(form, payload.registration.updatedAt, payload.metrics);
          }
          if (!response.ok || payload.ok !== true) {
            throw new Error(
              "message" in payload && typeof payload.message === "string"
                ? payload.message
                : "No se pudo actualizar el registro. Inténtalo nuevamente.",
            );
          }
          notifications.success({
            id: notificationId,
            title: "Interesado eliminado.",
          });
        } catch (failure) {
          const message =
            failure instanceof Error
              ? failure.message
              : "No pudimos confirmar el cambio. Revisa el estado antes de reintentar.";
          notifications.error({ id: notificationId, title: message });
          if (rowError) {
            rowError.textContent = message;
            rowError.hidden = false;
          }
        } finally {
          releaseMutation();
          locks.delete(id);
          row.removeAttribute("aria-busy");
          row.querySelector("summary")?.removeAttribute("aria-disabled");
          form.querySelectorAll("button").forEach((button) => {
            button.disabled = false;
          });
        }
      }

      function confirm(event: Event, form: HTMLFormElement) {
        const summary = form
          .closest("details")
          ?.querySelector<HTMLElement>("summary");
        event.preventDefault();
        const id = input(form, "interestRegistrationId").value;
        if (locks.has(id) || dialog?.open) return;
        selected = form;
        trigger = summary ?? null;
        const title = dialog?.querySelector("h2");
        const description = dialog?.querySelector("p");
        const accept = dialog?.querySelector("[data-dialog-confirm]");
        if (accept) accept.textContent = "Eliminar interesado";
        if (title) title.textContent = "Eliminar interesado";
        if (description)
          description.textContent =
            "Sus datos se quitarán definitivamente. Esta acción no se puede deshacer.";
        dialog?.showModal();
      }
      root.addEventListener("click", (event) => {
        const summary =
          event.target instanceof Element
            ? event.target.closest("summary")
            : null;
        const form = summary
          ?.closest("details")
          ?.querySelector<HTMLFormElement>("[data-interest-form]");
        if (form) confirm(event, form);
      });
      root.addEventListener("submit", (event) => {
        if (
          event.target instanceof HTMLFormElement &&
          event.target.matches("[data-interest-form]")
        )
          confirm(event, event.target);
      });
      root
        .querySelector("[data-dialog-confirm]")
        ?.addEventListener("click", () => {
          const form = selected;
          close();
          if (form) void mutate(form);
        });
      if (new URL(location.href).searchParams.get("success") === "updated") {
        notifications.success({ title: "Interesado eliminado." });
        const url = new URL(location.href);
        url.searchParams.delete("success");
        history.replaceState(history.state, "", url);
      }
    });
}
