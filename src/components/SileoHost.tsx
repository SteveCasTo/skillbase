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

export function SileoHost() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);
  const [modal, setModal] = useState<HTMLDialogElement | null>(null);

  useEffect(() => {
    // A native modal is in the browser top layer; no z-index can place a body
    // toast above it, and body siblings become inert. Portal the single host
    // into the active modal so pending feedback remains visible and focusable.
    const syncModal = () =>
      setModal(document.querySelector<HTMLDialogElement>("dialog:modal"));
    const observer = new MutationObserver(syncModal);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["open"],
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
    // Sileo 0.1.5 supports pointer swipes but its toast button has no keyboard
    // activation. Limit dismissal to a focused notice, never steal dialog Escape.
    const dismissFocusedNotices = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Enter" && event.key !== " ")
        return;
      if (
        !(event.target instanceof HTMLElement) ||
        !event.target.matches("[data-sileo-toast]")
      )
        return;
      event.preventDefault();
      notifications.clear();
    };
    document.addEventListener("keydown", dismissFocusedNotices);
    return () => document.removeEventListener("keydown", dismissFocusedNotices);
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
