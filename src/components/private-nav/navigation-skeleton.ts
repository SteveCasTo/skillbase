import type { TransitionBeforePreparationEvent } from "astro:transitions/client";

export function navigationSkeletonVariant(path: string) {
  const normalized = path.replace(/\/$/, "");
  if (/^\/app\/(preinscripciones|participantes)$/.test(normalized))
    return "list";
  if (
    normalized === "/app/preinscripciones/nueva" ||
    normalized === "/app/configuracion" ||
    /^\/app\/participantes\/[^/]+$/.test(normalized)
  )
    return "form";
  if (/^\/app\/preinscripciones\/[^/]+$/.test(normalized)) return "detail";
  if (/^\/app\/mis-cursos\/[^/]+\/grupos\/[^/]+$/.test(normalized))
    return "list";
  if (normalized === "/app/perfil") return "detail";
  if (/^\/app\/(instructores|mis-cursos)$/.test(normalized)) return "list";
  if (/^\/app\/instructores\/(nuevo|[^/]+\/editar)$/.test(normalized))
    return "form";
  if (/^\/app\/mis-cursos\/[^/]+$/.test(normalized)) return "detail";
  if (normalized === "/app" || normalized === "/app/asistencia")
    return "summary";
  if (/^\/app\/(cursos|formatos)$/.test(normalized)) return "list";
  if (normalized === "/app/interesados") return "list";
  if (/^\/app\/interesados\/[^/]+$/.test(normalized)) return "interests";
  if (/^\/app\/(cursos|formatos)\/nuevo$/.test(normalized)) return "form";
  if (/^\/app\/cursos\/[^/]+\/editar$/.test(normalized)) return "form";
  if (/^\/app\/cursos\/[^/]+\/grupos$/.test(normalized)) return "list";
  if (/^\/app\/formatos\/[^/]+$/.test(normalized)) return "detail";
  return null;
}

export function installNavigationSkeleton() {
  let restore: (() => void) | undefined;
  document.addEventListener("astro:before-preparation", (event) => {
    restore?.();
    const variant = navigationSkeletonVariant(event.to.pathname);
    // A POST may return validation errors on the same page, not a new structure.
    if (!variant || event.formData || event.to.origin !== location.origin)
      return;
    const main = document.querySelector<HTMLElement>("main#main-content");
    const page = main?.querySelector<HTMLElement>("[data-private-page]");
    const placeholder = main?.querySelector<HTMLElement>(
      "[data-navigation-skeleton]",
    );
    const template = main?.querySelector<HTMLTemplateElement>(
      `[data-navigation-template="${variant}"]`,
    );
    if (!main || !page || !placeholder || !template) return;
    const previousBusy = main.getAttribute("aria-busy");
    const previousHidden = page.getAttribute("aria-hidden");
    const previousInert = page.inert;
    const previousFocus =
      document.activeElement instanceof HTMLElement &&
      page.contains(document.activeElement)
        ? document.activeElement
        : null;
    const positionSkeleton = () => {
      const bounds = main.getBoundingClientRect();
      const viewport = main
        .closest(".private-main-scroll")
        ?.getBoundingClientRect();
      const top = Math.max(0, bounds.top, viewport?.top ?? 0);
      placeholder.style.left = `${Math.max(0, bounds.left)}px`;
      placeholder.style.top = `${top}px`;
      placeholder.style.width = `${Math.min(bounds.width, window.innerWidth - Math.max(0, bounds.left))}px`;
      placeholder.style.height = `${Math.max(0, Math.min(window.innerHeight, viewport?.bottom ?? window.innerHeight) - top)}px`;
    };
    positionSkeleton();
    window.addEventListener("scroll", positionSkeleton, true);
    window.addEventListener("resize", positionSkeleton);
    placeholder.replaceChildren(template.content.cloneNode(true));
    placeholder.hidden = false;
    main.setAttribute("aria-busy", "true");
    page.setAttribute("aria-hidden", "true");
    page.inert = true;
    page.style.visibility = "hidden";
    let finished = false;
    const finish = (recoverFocus = false) => {
      // An older aborted loader can finish after its replacement has started.
      if (finished) return;
      finished = true;
      placeholder.hidden = true;
      placeholder.replaceChildren();
      placeholder.removeAttribute("style");
      window.removeEventListener("scroll", positionSkeleton, true);
      window.removeEventListener("resize", positionSkeleton);
      page.style.removeProperty("visibility");
      page.inert = previousInert;
      if (previousHidden === null) page.removeAttribute("aria-hidden");
      else page.setAttribute("aria-hidden", previousHidden);
      if (previousBusy === null) main.removeAttribute("aria-busy");
      else main.setAttribute("aria-busy", previousBusy);
      if (recoverFocus && page.isConnected && previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
      event.signal.removeEventListener("abort", recover);
      if (restore === cleanup) restore = undefined;
    };
    const recover = () => finish(true);
    const cleanup = () => finish();
    restore = cleanup;
    event.signal.addEventListener("abort", recover, { once: true });
    const loader: TransitionBeforePreparationEvent["loader"] = event.loader;
    event.loader = async () => {
      try {
        await loader();
        if (event.defaultPrevented || event.signal.aborted) recover();
      } catch (error) {
        recover();
        throw error;
      } finally {
        // Also runs on rejected/cancelled loads and router full-page fallbacks.
        finish();
      }
    };
  });
  document.addEventListener("astro:after-swap", () => restore?.());
}
