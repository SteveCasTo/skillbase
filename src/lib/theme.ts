export const themes = ["light", "dark", "system"] as const;

export type Theme = (typeof themes)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && themes.includes(value as Theme);
}

export function resolveTheme(theme: Theme, systemPrefersDark: boolean) {
  return theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;
}

export function currentTheme(): Theme {
  const theme = document.documentElement.dataset.theme;
  return isTheme(theme) ? theme : "system";
}

declare global {
  interface Window {
    skillbaseThemePreference?: { value: Theme | null };
  }
}

export function surfaceTheme(preference: unknown, allowSystem: boolean): Theme {
  if (preference === "light" || preference === "dark") return preference;
  return allowSystem ? "system" : "light";
}

// Self-contained parameters let the exact same initializer run synchronously
// in the head (before paint) and before ClientRouter swaps document attributes.
function initializeThemePreference(
  choose: typeof surfaceTheme,
  resolve: typeof resolveTheme,
  target: Document = document,
) {
  if (!window.skillbaseThemePreference) {
    let value: Theme | null = null;
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark" || saved === "system")
        value = saved;
    } catch {
      // No stored choice: use the destination surface's default.
    }
    window.skillbaseThemePreference = { value };
  }
  const root = target.documentElement;
  const theme = choose(
    window.skillbaseThemePreference.value,
    root.dataset.allowSystemTheme !== "false",
  );
  const resolved = resolve(
    theme,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = resolved;
}

export const themeInitializationScript = `(${initializeThemePreference.toString()})(${surfaceTheme.toString()}, ${resolveTheme.toString()});`;

export function syncTheme(target: Document = document) {
  initializeThemePreference(surfaceTheme, resolveTheme, target);
}

export function syncThemeStorage(
  event: Pick<StorageEvent, "key" | "newValue">,
) {
  if (event.key !== "theme" && event.key !== null) return;
  window.skillbaseThemePreference = {
    value:
      event.key === "theme" && isTheme(event.newValue) ? event.newValue : null,
  };
  syncTheme();
}

export function applyTheme(theme: Theme, persist = false) {
  window.skillbaseThemePreference = { value: theme };
  syncTheme();
  if (persist) {
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // The active theme remains usable when storage is blocked.
    }
  }
}
