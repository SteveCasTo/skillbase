import { useEffect, useState } from "react";
import { Moon, Sun, SunMoon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isTheme, resolveTheme, themes, type Theme } from "@/lib/theme";

const labels: Record<Theme, string> = {
  light: "Claro",
  dark: "Oscuro",
  system: "Sistema",
};

const icons = {
  light: Sun,
  dark: Moon,
  system: SunMoon,
};

function applyTheme(theme: Theme) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  document.documentElement.classList.toggle(
    "dark",
    resolveTheme(theme, media.matches) === "dark",
  );
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = resolveTheme(
    theme,
    media.matches,
  );
}

export function ThemeSelector() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    const initialTheme = isTheme(savedTheme) ? savedTheme : "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      const currentTheme = localStorage.getItem("theme");
      applyTheme(isTheme(currentTheme) ? currentTheme : "system");
    };

    const frame = requestAnimationFrame(() => setTheme(initialTheme));
    applyTheme(initialTheme);
    media.addEventListener("change", syncSystemTheme);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", syncSystemTheme);
    };
  }, []);

  function selectTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <div
      className="bg-card flex rounded-lg border p-1 shadow-xs"
      aria-label="Tema de color"
    >
      {themes.map((option) => {
        const Icon = icons[option];

        return (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={theme === option ? "secondary" : "ghost"}
            aria-pressed={theme === option}
            onClick={() => selectTheme(option)}
          >
            <Icon data-icon="inline-start" aria-hidden="true" />
            <span className="hidden sm:inline">{labels[option]}</span>
            <span className="sr-only sm:hidden">{labels[option]}</span>
          </Button>
        );
      })}
    </div>
  );
}
