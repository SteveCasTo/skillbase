import { notifications } from "@/lib/notifications";
import { initializeInterestFilters } from "./admin-filter-client";
import {
  isAdminMetrics,
  isAdminRegistration,
  preferenceDemand,
  visibleAfterMutation,
} from "./admin-presentation";
import type {
  AdminInterestMetricsDto,
  AdminInterestRegistrationDto,
} from "@/domain/interests/types";

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
      initializeInterestFilters(root, () => mutations);
      let selected: HTMLFormElement | null = null;
      let trigger: HTMLElement | null = null;
      const error = root.querySelector<HTMLElement>("[data-interests-error]");
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
        row: HTMLElement,
        form: HTMLFormElement,
        registration: AdminInterestRegistrationDto,
        metrics: AdminInterestMetricsDto,
      ) {
        input(form, "revision").value = registration.updatedAt;
        input(form, "intent").value =
          registration.status === "ACTIVE" ? "cancel" : "reactivate";
        row.dataset.status = registration.status;
        const status = row.querySelector("[data-interest-status]");
        if (status)
          status.textContent =
            registration.status === "ACTIVE" ? "Activo" : "Cancelado";
        const summary = row.querySelector("summary");
        if (summary)
          summary.textContent =
            registration.status === "ACTIVE"
              ? "Cancelar interés"
              : "Reactivar interés";
        const button = form.querySelector("button");
        if (button)
          button.textContent =
            registration.status === "ACTIVE"
              ? "Confirmar cancelación"
              : "Confirmar reactivación";
        const copy = form.querySelector("[data-confirm-copy]");
        if (copy)
          copy.textContent =
            registration.status === "ACTIVE"
              ? "¿Cancelar este registro? Se conservará en el historial."
              : "¿Reactivar este registro de interés?";
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
        if (
          !visibleAfterMutation(root.dataset.filter ?? "", registration.status)
        ) {
          const hadFocus = row.contains(document.activeElement);
          row.remove();
          if (hadFocus)
            root
              .querySelector<HTMLElement>("#interest-list-title")
              ?.focus({ preventScroll: true });
        }
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
        if (error) error.hidden = true;
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
          const reconciles =
            (response.ok && payload.ok === true) ||
            (response.status === 409 &&
              "code" in payload &&
              payload.code === "STALE_INTEREST_REGISTRATION");
          if (reconciles) {
            if (
              !("registration" in payload) ||
              !("metrics" in payload) ||
              !isAdminRegistration(payload.registration, courseId, id) ||
              !isAdminMetrics(payload.metrics, courseId)
            )
              throw new Error(
                "La respuesta no es válida. Revisa el estado antes de reintentar.",
              );
            reconcile(row, form, payload.registration, payload.metrics);
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
            title: "Estado del interesado actualizado.",
          });
        } catch (failure) {
          const message =
            failure instanceof Error
              ? failure.message
              : "No pudimos confirmar el cambio. Revisa el estado antes de reintentar.";
          if (rowError && row.isConnected) {
            rowError.textContent = message;
            rowError.hidden = false;
          } else if (error) {
            error.textContent = message;
            error.hidden = false;
          }
          if ((rowError && row.isConnected) || error)
            notifications.dismiss(notificationId);
          else notifications.error({ id: notificationId, title: message });
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
        if (
          locks.has(id) ||
          dialog?.open ||
          root.dataset.filterPending === "true"
        )
          return;
        selected = form;
        trigger = summary ?? null;
        const cancelling = input(form, "intent").value === "cancel";
        const title = dialog?.querySelector("h2");
        const description = dialog?.querySelector("p");
        if (title)
          title.textContent = cancelling
            ? "Cancelar interés"
            : "Reactivar interés";
        if (description)
          description.textContent = cancelling
            ? "El registro dejará de contar como activo y se conservará en el historial."
            : "El registro volverá a contar entre los interesados activos.";
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
        notifications.success({ title: "Estado del interesado actualizado." });
        const url = new URL(location.href);
        url.searchParams.delete("success");
        history.replaceState(history.state, "", url);
      }
    });
}
