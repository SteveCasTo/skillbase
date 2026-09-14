export const themes = ["light", "dark", "system"] as const;

export type Theme = (typeof themes)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && themes.includes(value as Theme);
}

export function resolveTheme(theme: Theme, systemPrefersDark: boolean) {
  return theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;
}
