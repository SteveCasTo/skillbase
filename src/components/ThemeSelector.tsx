import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { applyTheme, currentTheme, type Theme } from "@/lib/theme";

export function ThemeSelector() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const syncTheme = () => setTheme(currentTheme());
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

  function toggleTheme() {
    const nextTheme: Theme =
      theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
    setTheme(nextTheme);
    applyTheme(nextTheme, true);
  }

  const nextThemeName =
    theme === "system" ? "oscuro" : theme === "dark" ? "claro" : "del sistema";

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="theme-toggle"
      data-theme-toggle
      data-current-theme={theme}
      aria-label={`Cambiar a modo ${nextThemeName}`}
      title={`Cambiar a modo ${nextThemeName}`}
      onClick={toggleTheme}
    >
      {theme === "light" ? (
        <Sun aria-hidden="true" />
      ) : theme === "dark" ? (
        <Moon aria-hidden="true" />
      ) : (
        <Monitor aria-hidden="true" />
      )}
    </Button>
  );
}
