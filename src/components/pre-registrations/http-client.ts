import { navigate } from "astro:transitions/client";
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
        ? "Datos actualizados"
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
            document
              .querySelectorAll<HTMLFormElement>("[data-participant-edit]")
              .forEach((peer) => {
                peer.dataset.participantBaseline = JSON.stringify(
                  value.participant,
                );
                const revision = peer.elements.namedItem("revision");
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
                  const input = peer.elements.namedItem(field);
                  if (input instanceof HTMLInputElement) {
                    const dirty = input.value !== input.defaultValue;
                    input.defaultValue = value.participant[field] ?? "";
                    if (peer === form || input.type === "hidden" || !dirty)
                      input.value = input.defaultValue;
                  }
                }
                const display = peer.querySelector<HTMLElement>(
                  "[data-inline-value]",
                );
                const field = peer.dataset.editField as
                  "ci" | "firstName" | "lastName" | "email" | "phone";
                if (display)
                  display.textContent =
                    value.participant[field] || "No indicado";
              });
            const error = form.querySelector<HTMLElement>("[data-form-error]");
            if (error) error.textContent = "";
            return;
          }
          form.dispatchEvent(new Event("registration:closing"));
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
      const selectPerson = (
        person: ParticipantDto | AdminInterestRegistrationDto,
        global: boolean,
      ) => {
        const form = document.getElementById(root.dataset.targetForm ?? "");
        if (!(form instanceof HTMLFormElement) || form.dataset.pending) return;
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
        if (source instanceof HTMLInputElement)
          source.value = global ? "" : person.id;
        const selected = root.querySelector<HTMLElement>(
          "[data-selected-person]",
        );
        if (selected)
          selected.textContent = `${person.firstName} ${person.lastName} · ${person.email}`;
        const clear = root.querySelector<HTMLButtonElement>(
          "[data-clear-person]",
        );
        if (clear) clear.hidden = false;
        root
          .querySelector<HTMLElement>("[data-search-results]")
          ?.replaceChildren();
        form.dispatchEvent(new Event("change", { bubbles: true }));
        const target = global
          ? form.querySelector<HTMLElement>('[data-slot="select-trigger"]')
          : form.elements.namedItem("ci");
        if (target instanceof HTMLElement) target.focus();
      };
      root
        .querySelectorAll<HTMLAnchorElement>("[data-choose-person]")
        .forEach((link) =>
          link.addEventListener("click", (event) => {
            event.preventDefault();
            selectPerson(
              JSON.parse(link.dataset.person!) as
                ParticipantDto | AdminInterestRegistrationDto,
              link.dataset.kind === "participant",
            );
          }),
        );
      root
        .querySelector<HTMLButtonElement>("[data-clear-person]")
        ?.addEventListener("click", (event) => {
          const form = document.getElementById(root.dataset.targetForm ?? "");
          if (!(form instanceof HTMLFormElement) || form.dataset.pending)
            return;
          for (const name of [
            "ci",
            "firstName",
            "lastName",
            "email",
            "phone",
            "sourceInterestId",
          ]) {
            const input = form.elements.namedItem(name);
            if (input instanceof HTMLInputElement) {
              input.value = "";
              input.readOnly = false;
            }
          }
          const selected = root.querySelector<HTMLElement>(
            "[data-selected-person]",
          );
          if (selected) selected.textContent = "";
          if (event.currentTarget instanceof HTMLButtonElement)
            event.currentTarget.hidden = true;
          form.dispatchEvent(new Event("change", { bubbles: true }));
          const ci = form.elements.namedItem("ci");
          if (ci instanceof HTMLElement) ci.focus();
        });
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
            item.className = "min-w-0";
            const title = document.createElement("p");
            title.className = "break-words font-medium";
            title.textContent = `${person.firstName} ${person.lastName}`;
            const note = document.createElement("p");
            note.className = "mt-1 break-words text-sm text-muted-foreground";
            note.textContent = person.email;
            const button = document.createElement("button");
            button.type = "button";
            button.className =
              "flex min-h-11 w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";
            button.addEventListener("click", () => {
              selectPerson(person, global);
            });
            if (root.dataset.targetForm) {
              button.append(title, note);
              item.append(button);
            } else {
              const link = document.createElement("a");
              link.className =
                "flex h-full min-w-0 flex-col gap-2 rounded-xl border p-5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";
              link.href = `/app/preinscripciones?${new URLSearchParams({ search: "ci" in person ? person.ci : person.firstName })}`;
              link.append(title);
              if ("ci" in person) {
                const ci = document.createElement("p");
                ci.className = "break-words text-sm text-muted-foreground";
                ci.textContent = `CI: ${person.ci}`;
                link.append(ci);
              }
              link.append(note);
              item.append(link);
            }
            list.append(item);
          }
          const empty = root.querySelector<HTMLElement>("[data-search-empty]");
          if (empty) {
            const query =
              root
                .querySelector<HTMLInputElement>('input[name="search"]')
                ?.value.trim() ?? "";
            empty.hidden = people.length > 0 || query.length < 2;
            empty.textContent = "Sin coincidencias.";
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  form
    .querySelector<HTMLElement>("[data-filter-submit]")
    ?.setAttribute("hidden", "");
  const run = async () => {
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
      // Keep the form and focused controls mounted; only course-dependent groups
      // and the result region are replaced. Last-request-wins protects both.
      const currentGroup = form.querySelector<HTMLElement>(
        "[data-group-filter]",
      );
      const newGroup = updated.querySelector<HTMLElement>(
        "[data-group-filter]",
      );
      const oldCourse = form.dataset.appliedCourse ?? "";
      const course = params.get("courseId") ?? "";
      if (oldCourse !== course && currentGroup && newGroup) {
        currentGroup.replaceWith(document.importNode(newGroup, true));
        form.dataset.appliedCourse = course;
      }
      const returnedForm = updated.querySelector("#registration-filters");
      returnedForm?.remove();
      [...region.children]
        .filter((child) => child !== form)
        .forEach((child) => child.remove());
      [...updated.children].forEach((child) =>
        region.append(document.importNode(child, true)),
      );
      history.replaceState(history.state, "", url);
      initializeRegistrationHttp();
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
  };
  const invalidate = () => {
    ++generation;
    controller?.abort();
    clearTimeout(timer);
  };
  form.dataset.appliedCourse =
    (form.elements.namedItem("courseId") as HTMLSelectElement)?.value ?? "";
  form.addEventListener("input", (event) => {
    if (
      !(event.target instanceof HTMLInputElement) ||
      event.target.name !== "search"
    )
      return;
    invalidate();
    timer = setTimeout(() => void run(), 250);
  });
  form.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLSelectElement)) return;
    invalidate();
    if (event.target.name === "courseId") {
      const group = form.elements.namedItem("groupId");
      if (group instanceof HTMLSelectElement) group.value = "";
    }
    void run();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    invalidate();
    void run();
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
