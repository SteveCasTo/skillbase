import { navigate } from "astro:transitions/client";
import { flushSync } from "react-dom";
import {
  bindRegistrationMutation,
  readFormValues,
  showFormIssues,
  type SubmitResult,
} from "@/components/pre-registrations/registration-client";
import {
  createRequestState,
  requestFingerprint,
} from "@/components/pre-registrations/request-state";
import { notifications } from "@/lib/notifications";
import { initializeInlineFields } from "@/components/pre-registrations/inline-field-client";
import { initializeSettingsInputs } from "@/components/pre-registrations/settings-input";
import { validateAbsenceLimit } from "@/domain/attendance/rules";
import {
  ATTENDANCE_STATUSES,
  type AttendanceCommandResult,
  type AttendanceSettingsDto,
} from "@/domain/attendance/types";
import type { AttendanceHttpPayload } from "@/server/attendance/http";
import {
  attendanceFormPayload,
  attendanceFieldIssues,
  parseAttendanceHttpPayload,
  validMarkValue,
} from "./presentation";
let refreshGeneration = 0;
let refreshController: AbortController | undefined;
const cancelRefresh = () => {
  ++refreshGeneration;
  refreshController?.abort();
};

const confirmedMarksAttribute = "data-attendance-confirmed-marks";

function confirmedMarkFormIds(panel: HTMLElement): Set<string> {
  try {
    const ids: unknown = JSON.parse(
      panel.getAttribute(confirmedMarksAttribute) ?? "[]",
    );
    return Array.isArray(ids) && ids.every((id) => typeof id === "string")
      ? new Set(ids.map((id: string) => `attendance-mark-${id}`))
      : new Set();
  } catch {
    return new Set();
  }
}

function rememberConfirmedMarks(
  panel: HTMLElement,
  registrationIds: readonly string[],
) {
  const ids = new Set(
    [...confirmedMarkFormIds(panel)].map((id) =>
      id.slice("attendance-mark-".length),
    ),
  );
  registrationIds.forEach((id) => ids.add(id));
  panel.setAttribute(confirmedMarksAttribute, JSON.stringify([...ids]));
}

async function readAttendanceResponse(
  response: Response,
): Promise<AttendanceHttpPayload> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("El servidor devolvió una respuesta inválida.");
  }
  const payload = parseAttendanceHttpPayload(value, response.ok);
  if (!payload) throw new Error("El servidor devolvió una respuesta inválida.");
  return payload;
}

async function refreshSession(
  path: string,
  savedFormId?: string,
  focusSelector?: string,
  savedFormIds: ReadonlySet<string> = new Set(),
) {
  cancelRefresh();
  const token = refreshGeneration;
  refreshController = new AbortController();
  const current = document.querySelector<HTMLElement>(
    "[data-attendance-session-panel]",
  );
  if (!current) return;
  const excludedFormIds = new Set([
    ...savedFormIds,
    ...confirmedMarkFormIds(current),
    ...(savedFormId ? [savedFormId] : []),
  ]);
  const captureDrafts = () =>
    [...current.querySelectorAll<HTMLFormElement>("[data-attendance-form]")]
      .filter((form) => !excludedFormIds.has(form.id))
      .map((form) => {
        const baseline = JSON.parse(form.dataset.baseline ?? "{}") as Record<
          string,
          string
        >;
        const values = readFormValues(form);
        const draftValue = (name: string) => {
          const control = form.elements.namedItem(name);
          return control instanceof HTMLInputElement ||
            control instanceof HTMLSelectElement
            ? control.value
            : (values[name] ?? "");
        };
        return {
          id: form.id,
          editing: form.dataset.markEditing === "true",
          values: Object.fromEntries(
            Object.entries(baseline)
              .filter(([name, value]) => draftValue(name) !== value)
              .map(([name]) => [name, draftValue(name)]),
          ),
        };
      });
  current.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(path, {
      headers: { "X-Attendance-Fragment": "1" },
      signal: refreshController.signal,
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("text/html")
    )
      throw new Error("Refresh unavailable");
    const parsed = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    const next = parsed.querySelector<HTMLElement>(
      "[data-attendance-session-panel]",
    );
    if (token !== refreshGeneration || !current.isConnected) return;
    if (!next) throw new Error("Missing session");
    const drafts = captureDrafts();
    // Fragment replacement is not an Astro navigation. Explicitly release
    // hydrated islands first, including dialogs that moved forms into portals.
    // Otherwise their old forms can outlive the panel with stale revisions/IDs.
    flushSync(() => {
      current.querySelectorAll("astro-island").forEach((island) => {
        island.dispatchEvent(new CustomEvent("astro:unmount"));
      });
    });
    current.replaceWith(document.importNode(next, true));
    drafts.forEach((draft) => {
      const form = document.getElementById(draft.id);
      if (!(form instanceof HTMLFormElement)) return;
      if (draft.editing) form.dataset.markEditing = "true";
      Object.entries(draft.values).forEach(([name, value]) => {
        const control = form.elements.namedItem(name);
        if (
          control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement
        )
          control.value = value;
      });
    });
    initializeAttendanceForms();
    document.dispatchEvent(new Event("attendance:fragment"));
    const saved = savedFormId ? document.getElementById(savedFormId) : null;
    const focus =
      (focusSelector
        ? document.querySelector<HTMLElement>(focusSelector)
        : null) ??
      saved?.querySelector<HTMLElement>("[data-mark-edit]") ??
      saved?.closest("article")?.querySelector<HTMLElement>("h3") ??
      document.querySelector<HTMLElement>("[data-attendance-title]");
    if (focus) {
      focus.tabIndex = -1;
      focus.focus({ preventScroll: true });
    }
  } catch (error) {
    if (token === refreshGeneration) throw error;
  } finally {
    current.removeAttribute("aria-busy");
  }
}

const hasPendingMutation = () =>
  Boolean(
    document.querySelector(
      "[data-attendance-form][data-pending], [data-attendance-mark-all][data-pending]",
    ),
  );

function initializeMarkAllButtons() {
  document
    .querySelectorAll<HTMLButtonElement>("[data-attendance-mark-all]")
    .forEach((button) => {
      if (button.dataset.bound) return;
      button.dataset.bound = "true";
      button.addEventListener("click", async () => {
        if (hasPendingMutation() || button.dataset.refreshRequired) return;
        const panel = button.closest<HTMLElement>(
          "[data-attendance-session-panel]",
        );
        if (!panel) return;
        const path = button.dataset.path;
        const revision = button.dataset.revision;
        if (!path || !revision) return;
        let targets: unknown;
        try {
          targets = JSON.parse(button.dataset.targets ?? "");
        } catch {
          return;
        }
        if (
          !Array.isArray(targets) ||
          targets.length === 0 ||
          !targets.every((target) => typeof target === "string")
        )
          return;
        const requestKey = crypto.randomUUID();
        button.dataset.pending = "true";
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        document
          .querySelectorAll<HTMLFormElement>("[data-attendance-form]")
          .forEach((form) => form.dispatchEvent(new Event("attendance:state")));
        try {
          await notifications.promise(
            async () => {
              cancelRefresh();
              const response = await fetch(`${path}?operation=record`, {
                method: "POST",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  requestKey,
                  revision: Number(revision),
                  marks: targets.map((registrationId: string) => ({
                    registrationId,
                    status: "PRESENT",
                  })),
                }),
                redirect: "manual",
              });
              if (response.type === "opaqueredirect")
                throw new Error("La sesión cambió. Inicia sesión nuevamente.");
              const payload = await readAttendanceResponse(response);
              if (!payload.ok) {
                if (
                  payload.code === "CONCURRENT_UPDATE" ||
                  payload.code === "IDEMPOTENCY_CONFLICT"
                ) {
                  button.dataset.refreshRequired = "true";
                  document
                    .querySelectorAll<HTMLFormElement>("[data-attendance-form]")
                    .forEach((form) => {
                      form.dataset.refreshRequired = "true";
                      form.dispatchEvent(new Event("attendance:state"));
                    });
                  document
                    .querySelector<HTMLElement>("[data-attendance-refresh]")
                    ?.removeAttribute("hidden");
                }
                throw new Error(payload.message);
              }
              if (
                payload.value.kind !== "session" ||
                payload.value.sessionId !== path.split("/").at(-1)
              )
                throw new Error("El servidor devolvió una respuesta inválida.");
              rememberConfirmedMarks(panel, targets);
              try {
                if (
                  panel.isConnected &&
                  document.querySelector("[data-attendance-session-panel]") ===
                    panel
                )
                  await refreshSession(
                    path,
                    undefined,
                    "[data-attendance-heading]",
                  );
              } catch {
                button.dataset.refreshRequired = "true";
                document
                  .querySelectorAll<HTMLFormElement>("[data-attendance-form]")
                  .forEach((form) => {
                    form.dataset.refreshRequired = "true";
                    form.dispatchEvent(new Event("attendance:state"));
                  });
                const error = document.querySelector<HTMLElement>(
                  "[data-attendance-page-error]",
                );
                if (error)
                  error.textContent =
                    "Operación guardada. Recarga la sesión para ver los cambios.";
                const refresh = document.querySelector<HTMLElement>(
                  "[data-attendance-refresh]",
                );
                refresh?.removeAttribute("hidden");
                refresh?.focus({ preventScroll: true });
              }
              return payload.value;
            },
            {
              loading: { title: "Marcando participantes presentes…" },
              success: { title: "Asistencia registrada" },
              error: (error) => ({
                title:
                  error instanceof Error
                    ? error.message
                    : "No se pudo registrar la asistencia.",
              }),
            },
          );
        } catch {
          // Sileo reports the rejected promise; keep current controls and drafts.
        } finally {
          delete button.dataset.pending;
          button.disabled = Boolean(button.dataset.refreshRequired);
          button.removeAttribute("aria-busy");
          document
            .querySelectorAll<HTMLFormElement>("[data-attendance-form]")
            .forEach((form) =>
              form.dispatchEvent(new Event("attendance:state")),
            );
        }
      });
    });
}
function updateSettings(
  form: HTMLFormElement,
  settings: AttendanceSettingsDto,
) {
  const input = form.elements.namedItem("consecutiveAbsenceLimit"),
    revision = form.elements.namedItem("revision");
  if (input instanceof HTMLInputElement)
    input.value = input.defaultValue = String(settings.consecutiveAbsenceLimit);
  if (revision instanceof HTMLInputElement)
    revision.value = String(settings.revision);
  form.dataset.baseline = JSON.stringify(settings);
  const display = form.querySelector<HTMLElement>("[data-inline-value]");
  if (display) display.textContent = String(settings.consecutiveAbsenceLimit);
  showFormIssues(form, {});
  form
    .querySelector<HTMLElement>("[data-attendance-settings-refresh]")
    ?.setAttribute("hidden", "");
}
function state(form: HTMLFormElement) {
  const values = readFormValues(form);
  const baseline = JSON.parse(form.dataset.baseline ?? "{}") as Record<
    string,
    string | number
  >;
  const operation = form.dataset.attendanceOperation;
  let valid =
      form.checkValidity() &&
      !form.dataset.refreshRequired &&
      !form.dataset.revisionConflict,
    dirty = true;
  if (operation === "settings") {
    try {
      validateAbsenceLimit(Number(values.consecutiveAbsenceLimit));
      valid = valid && /^\d+$/u.test(values.consecutiveAbsenceLimit ?? "");
    } catch {
      valid = false;
    }
    dirty =
      Number(values.consecutiveAbsenceLimit) !==
      baseline.consecutiveAbsenceLimit;
  } else if (operation === "record") {
    const field = "instructorStatus" in values ? "instructorStatus" : "marks";
    valid =
      valid &&
      (field === "marks"
        ? validMarkValue(values.marks ?? "")
        : ATTENDANCE_STATUSES.includes(
            values.instructorStatus as (typeof ATTENDANCE_STATUSES)[number],
          ));
    dirty = values[field] !== baseline[field];
  } else if (operation === "replace") {
    valid = valid && Boolean(values.replacementDate && values.replacementTime);
    dirty =
      values.replacementDate !== baseline.replacementDate ||
      values.replacementTime !== baseline.replacementTime;
  }
  return { valid, dirty };
}
function initializeAutosave(form: HTMLFormElement) {
  if (!form.hasAttribute("data-attendance-autosave")) return;
  const baseline = JSON.parse(form.dataset.baseline ?? "{}") as Record<
    string,
    string
  >;
  const marked = Boolean(Object.values(baseline)[0]);
  const display = form.querySelector<HTMLElement>("[data-mark-display]");
  const editor = form.querySelector<HTMLFieldSetElement>("[data-mark-editor]");
  const edit = form.querySelector<HTMLButtonElement>("[data-mark-edit]");
  const cancel = form.querySelector<HTMLButtonElement>("[data-mark-cancel]");
  const submit = form.querySelector<HTMLButtonElement>("[data-mark-submit]");
  const pending = form.querySelector<HTMLElement>("[data-mark-pending]");
  const open = (editing: boolean) => {
    if (display) display.hidden = editing;
    if (editor) editor.hidden = !editing;
    form.dataset.markEditing = String(editing);
    if (cancel) cancel.hidden = !marked;
  };
  const attempted =
    Boolean(form.dataset.lastSubmitted) ||
    (form.dataset.markEditing === "true" && state(form).dirty);
  open(!marked || attempted || form.dataset.markEditing === "true");
  if (submit) {
    submit.hidden = !attempted;
    submit.textContent = "Reintentar";
  }
  edit?.addEventListener("click", () => {
    if (hasPendingMutation()) return;
    open(true);
    editor
      ?.querySelector<HTMLElement>(
        '[data-slot="select-trigger"], select:not([hidden])',
      )
      ?.focus();
  });
  const discard = () => {
    if (form.dataset.pending || !marked) return;
    for (const [name, value] of Object.entries(baseline)) {
      const control = form.elements.namedItem(name);
      if (control instanceof HTMLSelectElement) control.value = value;
    }
    showFormIssues(form, {});
    form.dispatchEvent(new Event("attendance:reset"));
    if (submit) submit.hidden = true;
    open(false);
    edit?.focus({ preventScroll: true });
  };
  cancel?.addEventListener("click", discard);
  editor?.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && marked) {
      event.preventDefault();
      discard();
    }
  });
  form.addEventListener("change", () => {
    const result = state(form);
    if (result.valid && result.dirty && !hasPendingMutation())
      form.requestSubmit();
  });
  form.addEventListener("registration:updated", () => {
    const hasError =
      Boolean(form.dataset.saveFailed) ||
      Boolean(
        form
          .querySelector<HTMLElement>("[data-form-error]")
          ?.textContent?.trim(),
      ) ||
      Boolean(form.querySelector('[aria-invalid="true"]'));
    if (submit) submit.hidden = !hasError;
  });
  const sync = () => {
    if (pending)
      pending.textContent = form.dataset.pending ? "Guardando asistencia…" : "";
  };
  new MutationObserver(sync).observe(form, {
    attributes: true,
    attributeFilter: ["data-pending"],
  });
}
function bindAutosaveMutation(
  form: HTMLFormElement,
  adapter: {
    submit: (
      values: Readonly<Record<string, string>>,
    ) => Promise<SubmitResult<AttendanceCommandResult>>;
    onSuccess: (value: AttendanceCommandResult) => Promise<void>;
    successMessage: string;
  },
) {
  const key = form.elements.namedItem("requestKey");
  if (!(key instanceof HTMLInputElement)) return;
  const request = createRequestState(
    key.value,
    () => crypto.randomUUID(),
    form.dataset.lastSubmitted
      ? requestFingerprint(
          JSON.parse(form.dataset.lastSubmitted) as Record<string, string>,
        )
      : undefined,
  );
  form.addEventListener("submit", async (event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    const values = readFormValues(form);
    const requestKey = request.begin(requestFingerprint(values));
    if (!requestKey) return;
    key.value = requestKey;
    form.dataset.pending = "true";
    form.setAttribute("aria-busy", "true");
    const id = `attendance-${requestKey}`;
    showFormIssues(form, {});
    notifications.loading({ id, title: "Guardando asistencia…" });
    try {
      const result = await adapter.submit({ ...values, requestKey });
      if (result.ok) {
        delete form.dataset.saveFailed;
        await adapter.onSuccess(result.value);
        notifications.success({ id, title: adapter.successMessage });
      } else {
        showFormIssues(form, { ...result.issues, form: "" });
        if (form.querySelector('[aria-invalid="true"]'))
          notifications.dismiss(id);
        else notifications.error({ id, title: result.message });
        form.dataset.saveFailed = "true";
      }
    } catch {
      showFormIssues(form, {});
      form.dataset.saveFailed = "true";
      notifications.error({
        id,
        title:
          "No se pudo confirmar el guardado. Conservamos tus cambios; reintenta sin cambiar los datos.",
      });
    } finally {
      request.finish();
      delete form.dataset.pending;
      form.removeAttribute("aria-busy");
      form.dispatchEvent(new Event("registration:updated"));
      const alert = form.querySelector<HTMLElement>("[data-form-error]");
      if (alert?.textContent?.trim()) {
        alert.tabIndex = -1;
        alert.focus({ preventScroll: true });
      }
    }
  });
}
export function initializeAttendanceForms() {
  initializeMarkAllButtons();
  initializeInlineFields();
  initializeSettingsInputs();
  document
    .querySelectorAll<HTMLFormElement>("[data-attendance-form]")
    .forEach((form) => {
      if (form.dataset.attendanceBound) return;
      form.dataset.attendanceBound = "true";
      form.noValidate = true;
      const update = () => {
        // A successful POST is followed by an authoritative fragment GET.
        // Keep sibling session actions locked through both steps so a user
        // cannot open an obsolete dialog just before its island is replaced.
        const sessionPending = hasPendingMutation();
        document
          .querySelectorAll<HTMLButtonElement>(
            "[data-attendance-session-panel] button[data-operation-trigger]",
          )
          .forEach((button) => {
            button.disabled = sessionPending;
          });
        document
          .querySelectorAll<HTMLButtonElement>("[data-attendance-mark-all]")
          .forEach((button) => {
            button.disabled =
              sessionPending || Boolean(button.dataset.refreshRequired);
          });
        if (form.dataset.attendanceOperation === "cancel") {
          const choice = form.elements.namedItem("cancellationReasonChoice");
          const holiday =
            choice instanceof HTMLSelectElement && choice.value === "holiday";
          const custom = form.querySelector<HTMLElement>(
            "[data-cancellation-custom-reason]",
          );
          if (custom) custom.hidden = holiday;
          const reason = form.elements.namedItem("reason");
          if (reason instanceof HTMLInputElement)
            reason.disabled = holiday || Boolean(form.dataset.pending);
        }
        if (form.hasAttribute("data-attendance-autosave")) {
          const locked = Boolean(
            form.dataset.refreshRequired || hasPendingMutation(),
          );
          const editor =
            form.querySelector<HTMLFieldSetElement>("[data-mark-editor]");
          const edit =
            form.querySelector<HTMLButtonElement>("[data-mark-edit]");
          if (editor) editor.disabled = locked;
          if (edit) edit.disabled = locked;
        }
        const result = state(form);
        const submit = form.querySelector<HTMLButtonElement>(
          'button[type="submit"]',
        );
        if (submit)
          submit.disabled =
            !result.valid || !result.dirty || hasPendingMutation();
        return result;
      };
      form.addEventListener("input", update);
      form.addEventListener("change", update);
      form.addEventListener("focusout", (event) => {
        if (
          form.dataset.attendanceOperation !== "settings" ||
          !(event.target instanceof HTMLInputElement) ||
          event.target.name !== "consecutiveAbsenceLimit"
        )
          return;
        try {
          validateAbsenceLimit(
            /^\d+$/u.test(event.target.value)
              ? Number(event.target.value)
              : Number.NaN,
          );
          showFormIssues(form, {}, new Set(["consecutiveAbsenceLimit"]));
        } catch (error) {
          if (error && typeof error === "object" && "issues" in error)
            showFormIssues(
              form,
              {
                ...(error.issues as Record<string, string>),
              },
              new Set(["consecutiveAbsenceLimit"]),
            );
        }
      });
      form.addEventListener("registration:updated", () => {
        document
          .querySelectorAll<HTMLFormElement>("[data-attendance-form]")
          .forEach((peer) => peer.dispatchEvent(new Event("attendance:state")));
      });
      form.addEventListener("attendance:state", update);
      form.addEventListener("submit", (event) => {
        const result = update();
        if (!result.valid || !result.dirty || hasPendingMutation())
          event.preventDefault();
      });
      const bind = form.hasAttribute("data-attendance-autosave")
        ? bindAutosaveMutation
        : bindRegistrationMutation<AttendanceCommandResult>;
      bind(form, {
        submit: async (values) => {
          cancelRefresh();
          document
            .querySelectorAll<HTMLFormElement>("[data-attendance-form]")
            .forEach((peer) =>
              peer.dispatchEvent(new Event("attendance:state")),
            );
          const response = await fetch(form.action, {
            method: "POST",
            headers: { Accept: "application/json" },
            body: new URLSearchParams(
              attendanceFormPayload(values, form.dataset.attendanceOperation),
            ),
            redirect: "manual",
          });
          if (response.type === "opaqueredirect")
            return {
              ok: false,
              message:
                "La sesión cambió. Inicia sesión nuevamente para continuar.",
              issues: {},
            };
          const payload = await readAttendanceResponse(response);
          if (payload.ok) {
            const operation = form.dataset.attendanceOperation;
            const sessionId = new URL(form.action).pathname.split("/").at(-1);
            const expectedResult =
              operation === "settings"
                ? payload.value.kind === "settings"
                : payload.value.kind === "session" &&
                  (operation === "replace" ||
                    payload.value.sessionId === sessionId);
            if (!expectedResult)
              throw new Error("El servidor devolvió una respuesta inválida.");
          }
          if (!payload.ok)
            form
              .querySelector<HTMLElement>("[data-attendance-settings-refresh]")
              ?.removeAttribute("hidden");
          if (
            !payload.ok &&
            form.hasAttribute("data-attendance-autosave") &&
            (payload.code === "CONCURRENT_UPDATE" ||
              payload.code === "IDEMPOTENCY_CONFLICT")
          ) {
            form.dataset.revisionConflict = "true";
            document
              .querySelector<HTMLElement>("[data-attendance-refresh]")
              ?.removeAttribute("hidden");
          }
          if (!payload.ok && payload.issues.startsAt)
            form
              .querySelector<HTMLElement>("[data-civil-control]")
              ?.setAttribute("aria-invalid", "true");
          return payload.ok
            ? { ok: true, value: payload.value }
            : {
                ok: false,
                message: payload.message,
                issues: attendanceFieldIssues(payload.issues),
              };
        },
        onSuccess: async (value) => {
          if (value.kind === "settings") {
            updateSettings(form, value.settings);
            return;
          }
          form.dispatchEvent(new Event("registration:closing"));
          const path = new URL(form.action).pathname;
          if (value.sessionId !== path.split("/").at(-1)) {
            await navigate(
              `${path.slice(0, path.lastIndexOf("/"))}/${value.sessionId}`,
            );
            return;
          }
          try {
            await refreshSession(path, form.id);
          } catch {
            form.dataset.refreshRequired = "true";
            const error = document.querySelector<HTMLElement>(
              "[data-attendance-page-error]",
            );
            if (error)
              error.textContent =
                "Operación guardada. Recarga la sesión para ver los cambios.";
            document
              .querySelector<HTMLElement>("[data-attendance-refresh]")
              ?.removeAttribute("hidden");
          }
        },
        successMessage:
          form.dataset.attendanceOperation === "settings"
            ? "Configuración actualizada"
            : form.dataset.attendanceOperation === "replace"
              ? "Sesión reprogramada"
              : form.dataset.attendanceOperation === "cancel"
                ? "Sesión cancelada"
                : "Asistencia registrada",
      });
      initializeAutosave(form);
      update();
    });
  document
    .querySelectorAll<HTMLAnchorElement>("[data-attendance-refresh]")
    .forEach((link) => {
      if (link.dataset.bound) return;
      link.dataset.bound = "true";
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        if (link.dataset.pending || hasPendingMutation()) return;
        link.dataset.pending = "true";
        try {
          await refreshSession(link.href);
        } catch {
          const error = document.querySelector<HTMLElement>(
            "[data-attendance-page-error]",
          );
          if (error) error.textContent = "";
          notifications.error({
            title:
              "No se pudo actualizar la sesión. Conservamos tus cambios; reintenta.",
          });
        } finally {
          delete link.dataset.pending;
        }
      });
    });
}
initializeAttendanceForms();
document.addEventListener("astro:page-load", initializeAttendanceForms);
document.addEventListener("astro:before-swap", cancelRefresh);
