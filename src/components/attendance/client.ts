import { navigate } from "astro:transitions/client";
import {
  bindRegistrationMutation,
  readFormValues,
  showFormIssues,
} from "@/components/pre-registrations/registration-client";
import { initializeInlineFields } from "@/components/pre-registrations/inline-field-client";
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
  validMarkValue,
} from "./presentation";
let refreshGeneration = 0;
let refreshController: AbortController | undefined;
const cancelRefresh = () => {
  ++refreshGeneration;
  refreshController?.abort();
};

async function refreshSession(path: string, savedFormId?: string) {
  cancelRefresh();
  const token = refreshGeneration;
  refreshController = new AbortController();
  const current = document.querySelector<HTMLElement>(
    "[data-attendance-session-panel]",
  );
  if (!current) return;
  const captureDrafts = () =>
    [...current.querySelectorAll<HTMLFormElement>("[data-attendance-form]")]
      .filter((form) => form.id !== savedFormId)
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
    current.replaceWith(document.importNode(next, true));
    drafts.forEach((draft) => {
      const form = document.getElementById(draft.id);
      if (!(form instanceof HTMLFormElement)) return;
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
  let valid = form.checkValidity(),
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
export function initializeAttendanceForms() {
  initializeInlineFields();
  document
    .querySelectorAll<HTMLFormElement>("[data-attendance-form]")
    .forEach((form) => {
      if (form.dataset.attendanceBound) return;
      form.dataset.attendanceBound = "true";
      form.noValidate = true;
      const update = () => {
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
        const result = state(form);
        const submit = form.querySelector<HTMLButtonElement>(
          'button[type="submit"]',
        );
        if (submit)
          submit.disabled =
            !result.valid ||
            !result.dirty ||
            Boolean(
              document.querySelector("[data-attendance-form][data-pending]"),
            );
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
        if (
          !result.valid ||
          !result.dirty ||
          document.querySelector("[data-attendance-form][data-pending]")
        )
          event.preventDefault();
      });
      bindRegistrationMutation<AttendanceCommandResult>(form, {
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
          const payload = (await response.json()) as AttendanceHttpPayload;
          if (typeof payload.ok !== "boolean")
            throw new Error("Invalid response");
          if (!payload.ok)
            form
              .querySelector<HTMLElement>("[data-attendance-settings-refresh]")
              ?.removeAttribute("hidden");
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
      update();
    });
  document
    .querySelectorAll<HTMLAnchorElement>("[data-attendance-refresh]")
    .forEach((link) => {
      if (link.dataset.bound) return;
      link.dataset.bound = "true";
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        if (
          link.dataset.pending ||
          document.querySelector("[data-attendance-form][data-pending]")
        )
          return;
        link.dataset.pending = "true";
        try {
          await refreshSession(link.href);
        } catch {
          const error = document.querySelector<HTMLElement>(
            "[data-attendance-page-error]",
          );
          if (error)
            error.textContent =
              "No se pudo actualizar la sesión. Conservamos tus cambios; reintenta.";
        } finally {
          delete link.dataset.pending;
        }
      });
    });
}
initializeAttendanceForms();
document.addEventListener("astro:page-load", initializeAttendanceForms);
document.addEventListener("astro:before-swap", cancelRefresh);
