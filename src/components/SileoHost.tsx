import { useEffect, useState } from "react";
import { Toaster } from "sileo";

import { isTheme, type Theme } from "@/lib/theme";

export function SileoHost() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const syncTheme = () => {
      const currentTheme = document.documentElement.dataset.theme;
      setTheme(isTheme(currentTheme) ? currentTheme : "system");
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

  return <Toaster position="top-right" theme={theme} />;
}
