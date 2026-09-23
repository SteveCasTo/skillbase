import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isTheme, resolveTheme, type Theme } from "@/lib/theme";

function applyTheme(theme: Theme) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = resolveTheme(theme, media.matches) === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  return isDark;
}

export function ThemeSelector() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    const initialTheme = isTheme(savedTheme) ? savedTheme : "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      const currentTheme = localStorage.getItem("theme");
      const selectedTheme = isTheme(currentTheme) ? currentTheme : "system";
      setTheme(selectedTheme);
      applyTheme(selectedTheme);
    };

    const frame = requestAnimationFrame(() => {
      setTheme(initialTheme);
      applyTheme(initialTheme);
    });
    media.addEventListener("change", syncSystemTheme);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", syncSystemTheme);
    };
  }, []);

  function toggleTheme() {
    const nextTheme: Theme =
      theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
    localStorage.setItem("theme", nextTheme);
    setTheme(nextTheme);
    applyTheme(nextTheme);
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
