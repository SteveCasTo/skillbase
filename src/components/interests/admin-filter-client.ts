import { notifications } from "@/lib/notifications";
import type {
  TransitionBeforePreparationEvent,
  TransitionBeforeSwapEvent,
} from "astro:transitions/client";

/** Cancellation alone is insufficient when a response has already resolved. */
export function interestRequestGate() {
  let current: AbortController | undefined;
  return {
    begin() {
      current?.abort();
      const request = new AbortController();
      current = request;
      return {
        signal: request.signal,
        abort: () => request.abort(),
        isLatest: () => current === request,
        isCurrent: () => current === request && !request.signal.aborted,
      };
    },
    cancel() {
      current?.abort();
    },
  };
}

export function initializeInterestFilters(
  root: HTMLElement,
  waitForMutations: () => Promise<void>,
) {
  const form = root.querySelector<HTMLFormElement>("[data-interest-filter]");
  const error = root.querySelector<HTMLElement>("[data-interests-error]");
  const retry = root.querySelector<HTMLButtonElement>("[data-filter-retry]");
  const announcement = root.querySelector<HTMLElement>(
    "[data-filter-announcement]",
  );
  const skeleton = root.querySelector<HTMLElement>("[data-filter-skeleton]");
  if (!form || !error || !retry || !skeleton) return;
  const gate = interestRequestGate();
  let disposed = false;
  let attempted = new URL(location.href);
  const buttons = Array.from(
    form.querySelectorAll<HTMLButtonElement>("button[name=status]"),
  );
  function pending(value: boolean) {
    root.dataset.filterPending = String(value);
    root
      .querySelector("[data-interest-list]")
      ?.setAttribute("aria-busy", String(value));
    skeleton!.hidden = !value;
    // Keep previous cards/values intact for recovery; only their local region is pending.
    for (const selector of ["[data-interest-list]", "[data-interests-empty]"]) {
      const node = root.querySelector<HTMLElement>(selector);
      if (node) {
        node.inert = value;
        node.style.display = value ? "none" : "";
      }
    }
    if (announcement)
      announcement.textContent = value ? "Cargando interesados…" : "";
  }
  async function load(url: URL, push: boolean) {
    const request = gate.begin();
    const timeout = window.setTimeout(request.abort, 20_000);
    const hadListFocus = root
      .querySelector("[data-interest-list]")
      ?.contains(document.activeElement);
    attempted = url;
    error!.hidden = true;
    retry!.hidden = true;
    pending(true);
    let abortWait: (() => void) | undefined;
    try {
      await Promise.race([
        waitForMutations(),
        new Promise<never>((_, reject) => {
          abortWait = () => reject(new DOMException("Aborted", "AbortError"));
          request.signal.addEventListener("abort", abortWait, { once: true });
        }),
      ]);
      request.signal.throwIfAborted();
      if (!request.isCurrent()) return;
      const response = await fetch(url, {
        headers: { "X-Interest-Fragment": "1" },
        signal: request.signal,
        cache: "no-store",
      });
      request.signal.throwIfAborted();
      if (!request.isCurrent()) return;
      const destination = new URL(response.url);
      if (
        response.redirected &&
        destination.origin === location.origin &&
        ["/login", "/unauthorized"].includes(destination.pathname)
      ) {
        // Clear private data before leaving a session that is no longer authorized.
        root.querySelector("[data-interest-list]")?.replaceChildren();
        root.querySelector("[data-interest-metrics]")?.replaceChildren();
        location.assign(destination.href);
        return;
      }
      if (response.status === 401 || response.status === 403) {
        root.querySelector("[data-interest-list]")?.replaceChildren();
        root.querySelector("[data-interest-metrics]")?.replaceChildren();
        location.assign(
          response.status === 401
            ? `/login?next=${encodeURIComponent(url.pathname + url.search)}`
            : "/unauthorized?reason=forbidden",
        );
        return;
      }
      if (!response.ok) {
        if (response.status === 400)
          throw new Error(
            "El filtro no es válido. Elige Todos, Activos o Cancelados.",
          );
        if (response.status === 404)
          throw new Error(
            "Curso no encontrado. Consulta otros cursos desde Interesados.",
          );
        throw new Error(
          "No pudimos cargar los interesados. Reintenta la consulta; el listado anterior se conserva.",
        );
      }
      if (
        response.redirected ||
        response.headers.get("X-Interest-Fragment") !== "1" ||
        !response.headers.get("content-type")?.includes("text/html")
      )
        throw new Error(
          "No pudimos validar el listado. Reintenta la consulta.",
        );
      const html = await response.text();
      request.signal.throwIfAborted();
      if (!request.isCurrent()) return;
      const fragment = new DOMParser().parseFromString(html, "text/html");
      const incoming = fragment.querySelector<HTMLElement>(
        "[data-admin-interests]",
      );
      const filter = url.searchParams.get("status");
      const expected = filter === null || filter === "ALL" ? "" : filter;
      if (
        !incoming ||
        incoming.dataset.courseId !== root.dataset.courseId ||
        incoming.dataset.filter !== expected ||
        !["", "ACTIVE", "CANCELLED"].includes(expected)
      )
        throw new Error(
          "No pudimos validar el listado. Reintenta la consulta.",
        );
      const selectors = [
        "[data-interest-list]",
        "[data-interests-empty]",
        "[data-interest-metrics]",
      ];
      const replacements = selectors.map((selector) => ({
        old: root.querySelector(selector),
        next: incoming.querySelector(selector),
      }));
      if (replacements.some(({ old, next }) => !old || !next))
        throw new Error("El listado llegó incompleto. Reintenta la consulta.");
      for (const { old, next } of replacements) {
        if (old!.outerHTML !== next!.outerHTML)
          old!.replaceWith(document.importNode(next!, true));
      }
      root.dataset.filter = expected;
      for (const button of buttons) {
        const active =
          (button.value === "ALL" ? "" : button.value) === expected;
        button.setAttribute("aria-pressed", String(active));
        // Reuse exactly the SSR design-system variants.
        const matching = incoming.querySelector<HTMLButtonElement>(
          `button[name=status][value="${button.value}"]`,
        );
        if (matching) button.className = matching.className;
      }
      if (push) history.pushState(history.state, "", url.pathname + url.search);
      if (hadListFocus)
        root
          .querySelector<HTMLElement>("#interest-list-title")
          ?.focus({ preventScroll: true });
      pending(false);
      if (announcement)
        announcement.textContent = "Listado de interesados actualizado.";
    } catch (failure) {
      // Superseded requests must not reset loading, show errors, or apply their data.
      if (!request.isLatest() || disposed || !root.isConnected) return;
      const message = request.signal.aborted
        ? "La consulta tardó demasiado. Reintenta el filtro; el listado anterior se conserva."
        : failure instanceof TypeError
          ? "No pudimos conectar. Comprueba tu conexión y reintenta el filtro."
          : failure instanceof Error
            ? failure.message
            : "No pudimos cargar los interesados. Reintenta el filtro.";
      error!.textContent = message;
      error!.hidden = false;
      retry!.hidden = false;
      pending(false);
      if (hadListFocus)
        root
          .querySelector<HTMLElement>("#interest-list-title")
          ?.focus({ preventScroll: true });
      notifications.error({
        id: `notification-${crypto.randomUUID()}`,
        title: message,
      });
    } finally {
      if (abortWait) request.signal.removeEventListener("abort", abortWait);
      window.clearTimeout(timeout);
    }
  }
  form.addEventListener("submit", (event) => {
    const button = (event as SubmitEvent).submitter;
    if (!(button instanceof HTMLButtonElement)) return;
    event.preventDefault();
    const url = new URL(form.action);
    if (button.value !== "ALL") url.searchParams.set("status", button.value);
    void load(url, true);
  });
  retry.addEventListener(
    "click",
    () => void load(attempted, location.href !== attempted.href),
  );
  const back = (raw: Event) => {
    const event = raw as TransitionBeforePreparationEvent;
    if (
      event.navigationType === "traverse" &&
      event.to.origin === location.origin &&
      event.to.pathname === new URL(form.action).pathname &&
      root.isConnected
    ) {
      event.stopImmediatePropagation();
      localTraversals.add(event.signal);
      event.loader = async () => {
        const cancel = () => gate.cancel();
        event.signal.addEventListener("abort", cancel, { once: true });
        try {
          await load(event.to, false);
        } finally {
          event.signal.removeEventListener("abort", cancel);
        }
      };
    }
  };
  const localTraversals = new WeakSet<AbortSignal>();
  const preserveShell = (raw: Event) => {
    const event = raw as TransitionBeforeSwapEvent;
    if (localTraversals.has(event.signal)) {
      // Keep Astro's history bookkeeping, but never replace the document shell.
      event.swap = () => {};
      event.stopImmediatePropagation();
    }
  };
  // Capture above document before the shell's skeleton and router loader run.
  window.addEventListener("astro:before-preparation", back, true);
  window.addEventListener("astro:before-swap", preserveShell, true);
  document.addEventListener(
    "astro:before-swap",
    () => {
      disposed = true;
      gate.cancel();
      window.removeEventListener("astro:before-preparation", back, true);
      window.removeEventListener("astro:before-swap", preserveShell, true);
    },
    { once: true },
  );
}
