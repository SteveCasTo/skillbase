import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Toaster } from "sileo";

import {
  notificationPosition,
  notifications,
  showRedirectNotice,
} from "@/lib/notifications";
import { currentTheme, type Theme } from "@/lib/theme";

const toastOptions = { fill: "var(--card)" };
const noticeFocusReturn = new WeakMap<HTMLElement, HTMLElement>();

function dismissNotice(toast: HTMLElement) {
  if (toast.dataset.state === "loading") return;
  const id = toast.dataset.sileoId;
  if (id) {
    notifications.dismiss(id);
    const previous = noticeFocusReturn.get(toast);
    if (toast.contains(document.activeElement) && previous?.isConnected)
      previous.focus({ preventScroll: true });
  }
}

export function SileoHost() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);
  const [modal, setModal] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // A native modal is in the browser top layer; no z-index can place a body
    // toast above it, and body siblings become inert. Portal the single host
    // into the active modal so pending feedback remains visible and focusable.
    const syncModal = () =>
      setModal(
        [
          ...document.querySelectorAll<HTMLElement>(
            'dialog:modal, [data-slot="dialog-content"][data-state="open"]',
          ),
        ]
          .filter((element) => !element.closest("[hidden], [inert]"))
          .at(-1) ?? null,
      );
    const observer = new MutationObserver(syncModal);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["open", "data-state", "hidden", "inert"],
      childList: true,
      subtree: true,
    });
    document.addEventListener("astro:after-swap", syncModal);
    syncModal();
    return () => {
      observer.disconnect();
      document.removeEventListener("astro:after-swap", syncModal);
    };
  }, []);

  useEffect(() => {
    if (mounted) showRedirectNotice();
  }, [mounted]);

  useEffect(() => {
    // The patched notice is a focusable group containing an optional CTA.
    // Limit dismissal to that group, never steal CTA activation or dialog Escape.
    const dismissFocusedNotices = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Enter" && event.key !== " ")
        return;
      if (
        !(event.target instanceof HTMLElement) ||
        !event.target.matches("[data-sileo-toast]")
      )
        return;
      event.preventDefault();
      dismissNotice(event.target);
    };
    // The vendor expands descriptions and pauses expiry on hover only. Give
    // keyboard focus the same reading time/expansion, including older notices.
    const focusNotice = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const toast = event.target.closest<HTMLElement>("[data-sileo-toast]");
      if (!toast) return;
      if (
        event.relatedTarget instanceof Node &&
        toast.contains(event.relatedTarget)
      )
        return;
      if (
        event.type === "focusin" &&
        event.relatedTarget instanceof HTMLElement
      )
        noticeFocusReturn.set(toast, event.relatedTarget);
      toast.dispatchEvent(
        new MouseEvent(event.type === "focusin" ? "mouseover" : "mouseout", {
          bubbles: true,
          relatedTarget: event.relatedTarget,
        }),
      );
    };
    const dismissClickedNotices = (event: MouseEvent) => {
      if (
        !(event.target instanceof Element) ||
        event.target.closest("[data-sileo-button]")
      )
        return;
      const toast = event.target.closest<HTMLElement>("[data-sileo-toast]");
      if (toast) dismissNotice(toast);
    };
    document.addEventListener("keydown", dismissFocusedNotices);
    document.addEventListener("focusin", focusNotice);
    document.addEventListener("focusout", focusNotice);
    document.addEventListener("click", dismissClickedNotices);
    return () => {
      document.removeEventListener("keydown", dismissFocusedNotices);
      document.removeEventListener("focusin", focusNotice);
      document.removeEventListener("focusout", focusNotice);
      document.removeEventListener("click", dismissClickedNotices);
    };
  }, []);

  useEffect(() => {
    const syncTheme = () => {
      setTheme(currentTheme());
      setMounted(true);
    };
    const frame = requestAnimationFrame(syncTheme);
    const observer = new MutationObserver(syncTheme);

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // Mount after hydration: Sileo reads its external store on first render,
  // including notifications made by page scripts before the island loads.
  // Hydrating an SSR-empty Toaster against that store can discard early toasts.
  const toaster = (
    <Toaster
      position={notificationPosition}
      theme={theme}
      options={toastOptions}
    />
  );
  if (!mounted) return null;
  return modal ? createPortal(toaster, modal) : toaster;
}
