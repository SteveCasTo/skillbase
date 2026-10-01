import { notifications } from "@/lib/notifications";
import { groupEndTime } from "./group-schedule-preview";

interface GroupDto {
  id: string;
  revision: string;
  startTime: string;
  endTime: string;
  capacity: number;
  status: "PLANNED" | "CANCELLED";
  published: boolean;
}

function isGroup(value: unknown): value is GroupDto {
  if (!value || typeof value !== "object") return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "revision" in value &&
    typeof value.revision === "string" &&
    "startTime" in value &&
    typeof value.startTime === "string" &&
    "endTime" in value &&
    typeof value.endTime === "string" &&
    "capacity" in value &&
    typeof value.capacity === "number" &&
    "status" in value &&
    ["PLANNED", "CANCELLED"].includes(String(value.status)) &&
    "published" in value &&
    typeof value.published === "boolean"
  );
}

const messages: Record<string, string> = {
  create: "Grupo creado.",
  schedule: "Horario actualizado.",
  capacity: "Capacidad actualizada.",
  cancel: "Grupo desactivado; su historial se conserva.",
  reactivate: "Grupo reactivado.",
  delete: "Grupo eliminado.",
};

function initializeGroupManagement() {
  const error = document.querySelector<HTMLElement>("[data-group-error]");
  const list = document.querySelector<HTMLElement>("[data-groups-list]");
  const prototype = document.querySelector<HTMLTemplateElement>(
    "[data-group-template]",
  );
  if (!error || !list || !prototype || error.dataset.groupInitialized) return;
  error.dataset.groupInitialized = "true";
  const newDialog =
    document.querySelector<HTMLDialogElement>("[data-new-dialog]");
  const actionDialog = document.querySelector<HTMLDialogElement>(
    "[data-action-dialog]",
  );
  const newTrigger =
    document.querySelector<HTMLButtonElement>("[data-new-trigger]");
  let opener: HTMLElement | null = null;
  // Lock synchronously per entity, including forms sharing the same revision.
  const pending = new Set<string>();
  const versions = new Map<string, number>();
  const version = (id: string) => versions.get(id) ?? 0;
  const advance = (id: string) => versions.set(id, version(id) + 1);
  const rows = () =>
    Array.from(list.querySelectorAll<HTMLElement>("[data-group-id]"));
  const rowFor = (id: string) =>
    rows().find((row) => row.dataset.groupId === id);
  let occupied = rows().map((row) => ({
    id: row.dataset.groupId ?? "",
    startTime: row.dataset.startTime ?? "",
    endTime: row.dataset.endTime ?? "",
    status: row.dataset.status ?? "",
  }));
  const clearFields = (form: HTMLFormElement) => {
    form
      .querySelectorAll<HTMLElement>("[data-field-error]")
      .forEach((node) => (node.hidden = true));
    form
      .querySelectorAll<HTMLInputElement>("input[aria-invalid]")
      .forEach((node) => {
        node.removeAttribute("aria-invalid");
        node.removeAttribute("aria-describedby");
      });
  };
  const syncPreviews = () => {
    document
      .querySelectorAll<HTMLFormElement>(
        "[data-group-form][data-session-minutes]",
      )
      .forEach((form) => {
        if (form.closest("[data-group-template]")) return;
        const input =
          form.querySelector<HTMLInputElement>('[name="startTime"]');
        const output = form.querySelector<HTMLElement>("[data-group-end]");
        if (!input || !output) return;
        const end = groupEndTime(
          input.value,
          Number(form.dataset.sessionMinutes),
        );
        const id =
          form.querySelector<HTMLInputElement>('[name="groupId"]')?.value;
        const overlaps = Boolean(
          end &&
          occupied.some(
            (slot) =>
              slot.id !== id &&
              slot.status !== "CANCELLED" &&
              input.value < slot.endTime &&
              slot.startTime < end,
          ),
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
        if (form.closest('[data-group-field="schedule"]'))
          output.classList.toggle("sr-only", Boolean(end && !overlaps));
      });
  };
  const empty = () => {
    const node = document.querySelector<HTMLElement>("[data-groups-empty]");
    if (node) node.hidden = rows().length !== 0;
    syncPreviews();
  };
  const applyGroup = (group: GroupDto, intent?: string) => {
    occupied = [...occupied.filter((slot) => slot.id !== group.id), group];
    let row = rowFor(group.id);
    const created = !row;
    if (!row) {
      row = prototype.content.firstElementChild!.cloneNode(true) as HTMLElement;
      row.dataset.groupId = group.id;
      row.hidden = false;
      for (const node of [row, ...row.querySelectorAll<HTMLElement>("*")]) {
        for (const attr of Array.from(node.attributes)) {
          if (attr.value.includes("group-prototype"))
            node.setAttribute(
              attr.name,
              attr.value.replaceAll("group-prototype", group.id),
            );
        }
      }
      const number =
        Math.max(
          0,
          ...rows().map((item) =>
            Number(
              item.querySelector("h3")?.textContent?.replace("Grupo ", ""),
            ),
          ),
        ) + 1;
      row.querySelector("h3")!.textContent = `Grupo ${number}`;
      row
        .querySelectorAll<HTMLElement>("[aria-label]")
        .forEach((node) =>
          node.setAttribute(
            "aria-label",
            node
              .getAttribute("aria-label")!
              .replace(/grupo \d+/g, `grupo ${number}`),
          ),
        );
      list.insertBefore(row, prototype);
    }
    row.dataset.startTime = group.startTime;
    row.dataset.endTime = group.endTime;
    row.dataset.status = group.status;
    row
      .querySelectorAll<HTMLInputElement>('[name="groupId"]')
      .forEach((input) => (input.value = input.defaultValue = group.id));
    row
      .querySelectorAll<HTMLInputElement>('[name="revision"]')
      .forEach((input) => (input.value = input.defaultValue = group.revision));
    row.querySelector<HTMLElement>("[data-group-inactive]")!.hidden =
      group.status !== "CANCELLED";
    row.querySelector<HTMLElement>("[data-group-inactive]")!.textContent =
      group.status === "CANCELLED" ? "Inactivo" : "";
    for (const fieldName of ["schedule", "capacity"]) {
      const field = row.querySelector<HTMLElement>(
        `[data-group-field="${fieldName}"]`,
      )!;
      field.querySelector("dd > span")!.textContent =
        fieldName === "schedule"
          ? `${group.startTime}–${group.endTime}`
          : String(group.capacity);
      const details = field.querySelector<HTMLDetailsElement>("details");
      const input = field.querySelector<HTMLInputElement>(
        'input:not([type="hidden"])',
      );
      if (input) {
        const draft = input.value;
        const persisted =
          fieldName === "schedule" ? group.startTime : String(group.capacity);
        input.defaultValue = persisted;
        input.value =
          created || intent === fieldName || !details?.open ? persisted : draft;
      }
      if (details) {
        details.hidden = group.status === "CANCELLED";
        if (intent === fieldName || details.hidden) {
          details.open = false;
          if (intent === fieldName)
            details
              .querySelector<HTMLElement>("summary")
              ?.focus({ preventScroll: true });
        }
      }
    }
    const action = !group.published
      ? "delete"
      : group.status === "CANCELLED"
        ? "reactivate"
        : "cancel";
    const label =
      action === "delete"
        ? "Eliminar"
        : action === "cancel"
          ? "Desactivar"
          : "Reactivar";
    const trigger = row.querySelector<HTMLButtonElement>(
      "[data-action-trigger]",
    );
    if (trigger) {
      trigger.dataset.actionTrigger = action;
      const number = row
        .querySelector("h3")!
        .textContent?.replace("Grupo ", "");
      trigger.setAttribute("aria-label", `${label} grupo ${number}`);
      trigger.title = `${label} grupo ${number}`;
      trigger
        .querySelectorAll<HTMLElement>("[data-action-icon]")
        .forEach((icon) => (icon.hidden = icon.dataset.actionIcon !== action));
      trigger.hidden = action === "reactivate" && !newTrigger;
    }
    const actionForm = row.querySelector<HTMLFormElement>(
      "[data-action-fallback] form",
    );
    if (actionForm)
      actionForm.querySelector<HTMLInputElement>('[name="intent"]')!.value =
        action;
    if (created) enhance(row);
    empty();
    return row;
  };
  const readResponse = async (response: Response) => {
    if (
      response.redirected ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      throw new Error(
        "La sesión cambió. Vuelve a iniciar sesión antes de reintentar.",
      );
    const data: unknown = await response.json();
    if (!data || typeof data !== "object")
      throw new Error(
        "La respuesta no es válida. Consulta los datos actuales antes de reintentar.",
      );
    return data;
  };
  const showError = (
    message: string,
    recover?: () => Promise<void>,
    focus = true,
  ) => {
    error.replaceChildren(document.createTextNode(message));
    if (recover) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Consultar datos actuales";
      button.className = "block mt-2 min-h-11 underline underline-offset-4";
      button.addEventListener("click", () => {
        if (button.disabled) return;
        button.disabled = true;
        void recover()
          .then(() => {
            error.hidden = true;
          })
          .catch((failure: unknown) => {
            showError(
              failure instanceof Error
                ? failure.message
                : "No se pudieron consultar los datos.",
              recover,
            );
          })
          .finally(() => (button.disabled = false));
      });
      error.append(button);
    }
    error.hidden = false;
    error.tabIndex = -1;
    if (focus) error.focus({ preventScroll: true });
  };
  const refresh = async (id: string) => {
    const key = id || "create";
    if (pending.has(key))
      throw new Error(
        "Espera a que termine la operación del grupo antes de consultar sus datos.",
      );
    pending.add(key);
    const snapshotVersions = new Map(versions);
    const row = rowFor(id);
    const controls = Array.from(
      row?.querySelectorAll<HTMLButtonElement>(
        'button[type="submit"], [data-action-trigger]',
      ) ?? [],
    ).map((control) => ({ control, disabled: control.disabled }));
    if (!id && newTrigger)
      controls.push({ control: newTrigger, disabled: newTrigger.disabled });
    for (const { control } of controls) control.disabled = true;
    row?.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(location.pathname, {
        headers: { Accept: "application/json" },
      });
      const data = await readResponse(response);
      if (
        !response.ok ||
        !("groups" in data) ||
        !Array.isArray(data.groups) ||
        !data.groups.every(isGroup)
      )
        throw new Error("No se pudieron consultar los datos actuales.");
      const current = data.groups.find((group) => group.id === id);
      if (current) applyGroup(current, "refresh");
      else if (id) rowFor(id)?.remove();
      // Other cards keep their nodes and edits. Only the overlap snapshot changes.
      // A sibling POST may finish after this GET took its snapshot. Keep its newer
      // slot (or deletion) instead of installing stale server data from the read.
      const unchanged = (groupId: string) =>
        version(groupId) === (snapshotVersions.get(groupId) ?? 0) &&
        (groupId === id || !pending.has(groupId));
      occupied = [
        ...occupied.filter((slot) => !unchanged(slot.id)),
        ...data.groups.filter((group) => unchanged(group.id)),
      ];
      for (const group of data.groups) {
        if (!id && !rowFor(group.id) && unchanged(group.id)) applyGroup(group);
      }
      empty();
    } finally {
      pending.delete(key);
      for (const { control, disabled } of controls) control.disabled = disabled;
      row?.removeAttribute("aria-busy");
    }
  };
  document
    .querySelectorAll<HTMLAnchorElement>("[data-group-recover]")
    .forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (link.getAttribute("aria-busy") === "true") return;
        link.setAttribute("aria-busy", "true");
        void refresh(link.dataset.groupRecover ?? "")
          .then(() => {
            link
              .closest<HTMLElement>('[role="alert"]')
              ?.setAttribute("hidden", "");
          })
          .catch((failure: unknown) =>
            showError(
              failure instanceof Error
                ? failure.message
                : "No se pudieron consultar los datos.",
              () => refresh(link.dataset.groupRecover ?? ""),
            ),
          )
          .finally(() => link.removeAttribute("aria-busy"));
      });
    });
  function enhance(root: ParentNode) {
    root
      .querySelectorAll<HTMLButtonElement>("[data-action-trigger]")
      .forEach((button) => {
        if (button.closest("[data-group-template]")) return;
        const fallback = button.parentElement?.querySelector<HTMLElement>(
          "[data-action-fallback]",
        );
        if (!actionDialog || !fallback) return;
        fallback.hidden = true;
        button.hidden = false;
        button.addEventListener("click", () => {
          const source = fallback.querySelector<HTMLFormElement>("form")!;
          const values = new FormData(source);
          if (pending.has(String(values.get("groupId")))) return;
          opener = button;
          const target = actionDialog.querySelector<HTMLFormElement>("form")!;
          for (const name of ["intent", "groupId", "revision"])
            target.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value =
              String(values.get(name));
          const action = button.dataset.actionTrigger;
          const verb =
            action === "delete"
              ? "eliminar"
              : action === "cancel"
                ? "desactivar"
                : "reactivar";
          actionDialog.querySelector("#action-dialog-title")!.textContent =
            `¿${verb[0]!.toUpperCase()}${verb.slice(1)} grupo?`;
          actionDialog.querySelector(
            "#action-dialog-description",
          )!.textContent =
            action === "delete"
              ? "Se eliminará permanentemente. No se puede deshacer."
              : action === "cancel"
                ? "El grupo quedará inactivo y conservará su historial."
                : "El grupo volverá a estar activo.";
          target.querySelector('button[type="submit"]')!.textContent =
            `Sí, ${verb} grupo`;
          actionDialog.showModal();
        });
      });
    root
      .querySelectorAll<HTMLDetailsElement>("[data-edit-fallback]")
      .forEach((details) => {
        if (details.closest("[data-group-template]")) return;
        const form = details.querySelector<HTMLFormElement>("form")!;
        const cancel =
          details.querySelector<HTMLButtonElement>("[data-edit-cancel]")!;
        cancel.hidden = false;
        details.querySelector<HTMLElement>("[data-cancel-fallback]")!.hidden =
          true;
        cancel.addEventListener("click", () => {
          if (pending.has(String(new FormData(form).get("groupId")))) return;
          details.open = false;
          form.reset();
          clearFields(form);
          syncPreviews();
          details
            .querySelector<HTMLElement>("summary")
            ?.focus({ preventScroll: true });
        });
        details.addEventListener("toggle", () => {
          if (details.open)
            details
              .querySelector<HTMLInputElement>('input:not([type="hidden"])')
              ?.focus({ preventScroll: true });
        });
      });
    root
      .querySelectorAll<HTMLFormElement>("[data-group-form]")
      .forEach((form) => {
        if (form.closest("[data-group-template]")) return;
        form
          .querySelector<HTMLInputElement>('[name="startTime"]')
          ?.addEventListener("input", syncPreviews);
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const body = new FormData(form);
          const id = String(body.get("groupId") ?? "");
          const key = id || "create";
          if (pending.has(key)) return;
          const intent = String(body.get("intent"));
          const button = form.querySelector<HTMLButtonElement>(
            'button[type="submit"]',
          );
          if (!button || button.disabled) return;
          pending.add(key);
          advance(id);
          const sharedConfirmation = Boolean(
            form.closest("[data-action-dialog]"),
          );
          const inputs = Array.from(
            form.querySelectorAll<HTMLInputElement>(
              'input:not([type="hidden"])',
            ),
          ).map((input) => ({ input, disabled: input.disabled }));
          for (const { input } of inputs) input.disabled = true;
          let invalidField: HTMLInputElement | null = null;
          button.disabled = true;
          button.setAttribute("aria-busy", "true");
          const row = rowFor(id);
          row?.setAttribute("aria-busy", "true");
          const trigger = id
            ? row?.querySelector<HTMLButtonElement>("[data-action-trigger]")
            : newTrigger;
          if (trigger) trigger.disabled = true;
          clearFields(form);
          error!.hidden = true;
          // Confirmation acceptance closes synchronously, not after network completion.
          if (actionDialog?.open && form.closest("[data-action-dialog]")) {
            actionDialog.close();
            // The request owns its captured FormData, not this shared dialog.
            // Other groups can confirm independently while this card is busy.
            button.disabled = false;
            button.removeAttribute("aria-busy");
            if (row) {
              row.tabIndex = -1;
              row.focus({ preventScroll: true });
            }
          }
          const operation = (async () => {
            const response = await fetch(location.pathname, {
              method: "POST",
              headers: { Accept: "application/json" },
              body,
            });
            const data = await readResponse(response);
            const message =
              "message" in data && typeof data.message === "string"
                ? data.message
                : "No se pudo completar la acción.";
            if (!response.ok) {
              const code = "code" in data ? data.code : "";
              if (
                (response.status === 422 || code === "SCHEDULE_CONFLICT") &&
                ["create", "schedule", "capacity"].includes(intent)
              ) {
                const target =
                  intent === "capacity" ||
                  (intent === "create" && /capacidad/i.test(message))
                    ? "capacity"
                    : "startTime";
                const input = form.querySelector<HTMLInputElement>(
                  `[name="${target}"]`,
                );
                const fieldError = form.querySelector<HTMLElement>(
                  `[data-field-error="${target}"]`,
                );
                if (input && fieldError) {
                  fieldError.textContent = message;
                  fieldError.hidden = false;
                  input.setAttribute("aria-invalid", "true");
                  input.setAttribute("aria-describedby", fieldError.id);
                  invalidField = input;
                }
              }
              throw new Error(message);
            }
            if (intent === "delete") {
              if (
                !("id" in data) ||
                data.id !== id ||
                !("group" in data) ||
                data.group !== null
              )
                throw new Error("No se pudo confirmar la eliminación.");
              rowFor(id)?.remove();
              occupied = occupied.filter((slot) => slot.id !== id);
              empty();
              newTrigger?.focus({ preventScroll: true });
            } else {
              if (!("group" in data) || !isGroup(data.group))
                throw new Error(
                  "No se pudo confirmar el cambio. Consulta los datos actuales.",
                );
              if (intent === "create") advance(data.group.id);
              applyGroup(data.group, intent);
              if (intent === "create") {
                form.reset();
                newDialog?.close();
                syncPreviews();
              } else if (["cancel", "reactivate"].includes(intent))
                rowFor(id)
                  ?.querySelector<HTMLButtonElement>("[data-action-trigger]")
                  ?.focus({ preventScroll: true });
            }
          })();
          void notifications.promise(operation, {
            loading: { title: "Guardando grupo…" },
            success: { title: messages[intent] ?? "Grupo actualizado." },
            error: (failure: unknown) => ({
              title:
                failure instanceof Error
                  ? failure.message
                  : "No se pudo completar la acción.",
            }),
          });
          void operation
            .catch((failure: unknown) => {
              showError(
                failure instanceof Error
                  ? failure.message
                  : "No se pudo completar la acción.",
                () => refresh(id),
                invalidField === null,
              );
            })
            .finally(() => {
              pending.delete(key);
              advance(id);
              for (const { input, disabled } of inputs)
                input.disabled = disabled;
              if (!sharedConfirmation) {
                button.disabled = false;
                button.removeAttribute("aria-busy");
              }
              row?.removeAttribute("aria-busy");
              if (trigger) trigger.disabled = false;
              if (row && document.activeElement === row)
                trigger?.focus({ preventScroll: true });
              invalidField?.focus({ preventScroll: true });
            });
        });
      });
  }
  if (newDialog && newTrigger) {
    document.querySelector<HTMLElement>("[data-new-fallback]")!.hidden = true;
    newTrigger.hidden = false;
    newTrigger.addEventListener("click", () => {
      if (pending.has("create")) return;
      opener = newTrigger;
      newDialog.showModal();
    });
  }
  for (const dialog of [newDialog, actionDialog]) {
    dialog
      ?.querySelector<HTMLButtonElement>("[data-dialog-close]")
      ?.addEventListener("click", () => dialog.close());
    dialog?.addEventListener("close", () =>
      opener?.focus({ preventScroll: true }),
    );
  }
  enhance(document);
  syncPreviews();
}

document.addEventListener("astro:page-load", initializeGroupManagement);
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", initializeGroupManagement, {
    once: true,
  });
else initializeGroupManagement();
