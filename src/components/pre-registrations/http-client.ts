import { navigate } from "astro:transitions/client";
import { buttonVariants } from "@/components/ui/button";
import {
  bindRegistrationMutation,
  initializeRegistrationForms,
} from "./registration-client";
import { bindParticipantLookup } from "./search-client";
import { notifications } from "@/lib/notifications";
import type {
  RegistrationHttpPayload,
  RegistrationHttpValue,
} from "@/server/pre-registrations/http";
import type { ParticipantDto } from "@/domain/pre-registrations/types";
import type { AdminInterestRegistrationDto } from "@/domain/interests/types";

async function send(
  form: HTMLFormElement,
  values: Readonly<Record<string, string>>,
) {
  const response = await fetch(form.action, {
    method: "POST",
    body: new URLSearchParams(values),
    headers: { Accept: "application/json" },
    redirect: "manual",
  });
  if (response.type === "opaqueredirect")
    return {
      ok: false as const,
      message:
        "La sesión cambió. Abre nuevamente esta página e inicia sesión para continuar.",
      issues: {},
    };
  const payload = (await response.json()) as RegistrationHttpPayload;
  if (typeof payload.ok !== "boolean") throw new Error("Invalid response");
  return payload;
}
async function refreshDetail(value: RegistrationHttpValue) {
  if (value.kind !== "detail") return;
  const response = await fetch(
    `/app/preinscripciones/${value.detail.registration.id}`,
    { headers: { "X-Registration-Fragment": "1" } },
  );
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/html")
  )
    throw new Error("Refresh failed");
  const parsed = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  );
  const updated = parsed.querySelector<HTMLElement>(
    "[data-registration-panel]",
  );
  const current = document.querySelector<HTMLElement>(
    "[data-registration-panel]",
  );
  if (!updated || !current) throw new Error("Missing panel");
  current.replaceWith(document.importNode(updated, true));
  const registration = value.detail.registration;
  const personName = document.querySelector<HTMLElement>(
    "[data-registration-person-name]",
  );
  if (personName)
    personName.textContent = `${registration.participant.firstName} ${registration.participant.lastName}`;
  const groupLabel = document.querySelector<HTMLElement>(
    "[data-registration-course-group]",
  );
  if (groupLabel)
    groupLabel.textContent = `${registration.courseName ?? groupLabel.dataset.courseName ?? "Curso"} · ${registration.groupName ?? "Grupo asignado"}`;
  document.dispatchEvent(new Event("registration:fragment"));
  // Only affected money/history/action panels change; sidebar/page identity stays.
  initializeRegistrationHttp();
  const heading = document.querySelector<HTMLElement>(
    "[data-registration-panel] h2",
  );
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
}
function bindForms() {
  initializeRegistrationForms();
  document
    .querySelectorAll<HTMLFormElement>(
      "[data-registration-form], [data-cash-form], [data-transfer-form], [data-cancellation-form], [data-participant-edit]",
    )
    .forEach((form) => {
      if (form.dataset.httpBound) return;
      if (!form.dataset.bound && !form.hasAttribute("data-cancellation-form"))
        return;
      form.dataset.httpBound = "true";
      if (form.hasAttribute("data-cancellation-form"))
        form.addEventListener("submit", (event) => {
          const reason = form.elements.namedItem("reason");
          if (
            !(reason instanceof HTMLInputElement) ||
            !reason.value.trim() ||
            !reason.validity.valid ||
            form.dataset.pending
          )
            event.preventDefault();
        });
      const label = form.hasAttribute("data-participant-edit")
        ? "Ficha global actualizada"
        : form.hasAttribute("data-cancellation-form")
          ? "Preinscripción cancelada"
          : "Operación registrada";
      bindRegistrationMutation<RegistrationHttpValue>(form, {
        submit: async (values) => {
          const payload = await send(form, values);
          return payload.ok
            ? { ok: true, value: payload.value }
            : { ok: false, message: payload.message, issues: payload.issues };
        },
        onSuccess: async (value) => {
          if (value.kind === "created") {
            await navigate(value.location);
            return;
          }
          if (value.kind === "participant") {
            // Reconcile baseline and optimistic revision before registration:updated.
            form.dataset.participantBaseline = JSON.stringify(
              value.participant,
            );
            const revision = form.elements.namedItem("revision");
            if (revision instanceof HTMLInputElement)
              revision.value = revision.defaultValue =
                value.participant.revision;
            for (const field of [
              "ci",
              "firstName",
              "lastName",
              "email",
              "phone",
            ] as const) {
              const input = form.elements.namedItem(field);
              if (input instanceof HTMLInputElement)
                input.value = input.defaultValue =
                  value.participant[field] ?? "";
            }
            const error = form.querySelector<HTMLElement>("[data-form-error]");
            if (error) error.textContent = "";
            return;
          }
          await refreshDetail(value);
        },
        successMessage: label,
      });
    });
}
function bindLookup() {
  document
    .querySelectorAll<HTMLElement>("[data-registration-lookup]")
    .forEach((wrapper) => {
      if (wrapper.dataset.httpBound) return;
      wrapper.dataset.httpBound = "true";
      const root = wrapper.querySelector<HTMLElement>(
        "[data-participant-search]",
      );
      if (!root) return;
      bindParticipantLookup(root, {
        load: async (query, signal) => {
          const params = new URLSearchParams({ search: query });
          if (wrapper.dataset.lookupCourse)
            params.set("courseId", wrapper.dataset.lookupCourse);
          const response = await fetch(
            `/app/preinscripciones/buscar?${params}`,
            { signal, headers: { Accept: "application/json" } },
          );
          if (!response.ok) throw new Error("Search failed");
          const payload = (await response.json()) as {
            ok: boolean;
            participants: readonly ParticipantDto[];
            interests: readonly AdminInterestRegistrationDto[];
          };
          if (
            !payload.ok ||
            !Array.isArray(payload.participants) ||
            !Array.isArray(payload.interests)
          )
            throw new Error("Search failed");
          return payload;
        },
        onResults: (result) => {
          const list = root.querySelector<HTMLElement>("[data-search-results]");
          if (!list) return;
          list.replaceChildren();
          const people = [
            ...result.participants.map((person) => ({ person, global: true })),
            ...result.interests.map((person) => ({ person, global: false })),
          ].slice(0, 30);
          for (const { person, global } of people) {
            const item = document.createElement("li");
            item.className = "min-w-0 py-4";
            const title = document.createElement("p");
            title.className = "break-words font-medium";
            title.textContent = `${person.firstName} ${person.lastName}`;
            const note = document.createElement("p");
            note.className = "mt-1 break-words text-sm text-muted-foreground";
            note.textContent =
              global && "ci" in person
                ? `Ficha global · CI ${person.ci}`
                : `Interesado · ${person.email}`;
            const button = document.createElement("button");
            button.type = "button";
            button.className = buttonVariants({
              variant: "outline",
              className: "mt-3 min-h-11",
            });
            button.textContent = "Usar datos";
            button.addEventListener("click", () => {
              const form = document.getElementById(
                root.dataset.targetForm ?? "",
              );
              if (!(form instanceof HTMLFormElement) || form.dataset.pending)
                return;
              const fields = {
                ci: "ci" in person ? person.ci : "",
                firstName: person.firstName,
                lastName: person.lastName,
                email: person.email,
                phone: person.phone ?? "",
              };
              Object.entries(fields).forEach(([name, value]) => {
                const input = form.elements.namedItem(name);
                if (input instanceof HTMLInputElement) {
                  input.value = value;
                  input.readOnly = global;
                }
              });
              const source = form.elements.namedItem("sourceInterestId");
              if (!global && source instanceof HTMLInputElement)
                source.value = person.id;
              const origin = form.querySelector<HTMLElement>(
                "[data-source-origin]",
              );
              if (origin && source instanceof HTMLInputElement)
                origin.hidden = !source.value;
              const selected = root.querySelector<HTMLElement>(
                "[data-selected-person]",
              );
              if (selected)
                selected.textContent = global
                  ? "Ficha global seleccionada. Cambia sus datos desde la página dedicada de ficha global."
                  : "Interesado seleccionado. Completa el CI; el interés público se conserva.";
              const clear = root.querySelector<HTMLButtonElement>(
                "[data-clear-person]",
              );
              if (clear) clear.hidden = false;
              form.dispatchEvent(new Event("change", { bubbles: true }));
              const target = global
                ? form.querySelector<HTMLElement>(
                    '[data-slot="select-trigger"]',
                  )
                : form.elements.namedItem("ci");
              if (target instanceof HTMLElement) target.focus();
            });
            if (root.dataset.targetForm) item.append(title, note, button);
            else {
              const link = document.createElement("a");
              link.className = buttonVariants({
                variant: "outline",
                className: "mt-3 min-h-11",
              });
              link.href = `/app/preinscripciones?${new URLSearchParams({ search: "ci" in person ? person.ci : person.firstName })}`;
              link.textContent = "Ver preinscripciones";
              item.append(title, note, link);
            }
            list.append(item);
          }
          const empty = root.querySelector<HTMLElement>("[data-search-empty]");
          if (empty) {
            empty.hidden = people.length > 0;
            empty.textContent =
              "Sin coincidencias. Puedes completar la ficha directamente.";
          }
        },
      });
    });
}
function bindFilters() {
  const form = document.querySelector<HTMLFormElement>("#registration-filters");
  if (!form || form.dataset.httpBound) return;
  form.dataset.httpBound = "true";
  let controller: AbortController | undefined;
  let generation = 0;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = ++generation;
    controller?.abort();
    controller = new AbortController();
    const params = new URLSearchParams();
    new FormData(form).forEach((value, name) => {
      if (typeof value === "string" && value) params.set(name, value);
    });
    const url = `/app/preinscripciones?${params}`;
    const region = document.querySelector<HTMLElement>(
      "[data-registration-list-region]",
    );
    const loading = document.querySelector<HTMLElement>(
      "[data-registration-list-loading]",
    );
    const error = document.querySelector<HTMLElement>(
      "[data-registration-page-error]",
    );
    region?.setAttribute("aria-busy", "true");
    if (loading) loading.hidden = false;
    if (error) error.textContent = "";
    try {
      const response = await fetch(url, {
        headers: { "X-Registration-Fragment": "1" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not filter");
      const doc = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      const updated = doc.querySelector<HTMLElement>(
        "[data-registration-list-region]",
      );
      if (token !== generation) return;
      if (!updated || !region) throw new Error("Missing list");
      region.replaceWith(document.importNode(updated, true));
      history.replaceState(history.state, "", url);
      initializeRegistrationHttp();
      document
        .querySelector<HTMLInputElement>("#registration-filters-search")
        ?.focus();
    } catch {
      if (token === generation && error)
        error.textContent =
          "No se pudo actualizar la lista. Conservamos los filtros; reintenta.";
    } finally {
      if (token === generation) {
        region?.removeAttribute("aria-busy");
        if (loading) loading.hidden = true;
      }
    }
  });
}
function bindExports() {
  document
    .querySelectorAll<HTMLAnchorElement>("[data-registration-export]")
    .forEach((link) => {
      if (link.dataset.httpBound) return;
      link.dataset.httpBound = "true";
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        if (link.dataset.pending) return;
        link.dataset.pending = "true";
        link.setAttribute("aria-disabled", "true");
        link.setAttribute("aria-busy", "true");
        const id = `registration-export-${crypto.randomUUID()}`;
        notifications.loading({ id, title: "Preparando exportación…" });
        try {
          const response = await fetch(link.href);
          if (!response.ok) {
            const error = (await response.json()) as {
              message?: string;
              code?: string;
            };
            const message =
              error.message ?? "No se pudo exportar. Reintenta o utiliza CSV.";
            const inline = document.querySelector<HTMLElement>(
              "[data-registration-page-error]",
            );
            if (inline) inline.textContent = message;
            notifications.warning({
              id,
              title: "Exportación no disponible",
              description: message,
            });
            return;
          }
          const filename = response.headers
            .get("content-disposition")
            ?.match(/filename="([a-z0-9.-]+)"/iu)?.[1];
          if (!filename) throw new Error("Missing filename");
          const url = URL.createObjectURL(await response.blob());
          const download = document.createElement("a");
          download.href = url;
          download.download = filename;
          download.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
          notifications.success({ id, title: "Exportación descargada" });
        } catch {
          const message =
            "No se pudo descargar la exportación. Conserva los filtros y reintenta.";
          const inline = document.querySelector<HTMLElement>(
            "[data-registration-page-error]",
          );
          if (inline) inline.textContent = message;
          notifications.error({
            id,
            title: "Sin descarga",
            description: message,
          });
        } finally {
          delete link.dataset.pending;
          link.removeAttribute("aria-disabled");
          link.removeAttribute("aria-busy");
        }
      });
    });
}
export function initializeRegistrationHttp() {
  bindForms();
  bindLookup();
  bindFilters();
  bindExports();
}
document.addEventListener(
  "registration:forms-ready",
  initializeRegistrationHttp,
);
