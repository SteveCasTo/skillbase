import { useEffect, useState } from "react";
import { Toaster } from "sileo";

import { currentTheme, type Theme } from "@/lib/theme";

const toastOptions = { fill: "var(--card)" };

export function SileoHost() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

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
  // including direct sileo calls made by page scripts before the island loads.
  // Hydrating an SSR-empty Toaster against that store can discard early toasts.
  return mounted ? (
    <Toaster position="top-right" theme={theme} options={toastOptions} />
  ) : null;
}
