import { expect, test } from "@playwright/test";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test("private success toast uses semantic theme colors in light and dark modes", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/formatos?success=created");
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Formato creado",
  );

  const viewport = page.locator("[data-sileo-viewport]");
  const tokenPairs = [
    ["success", "primary"],
    ["loading", "muted-foreground"],
    ["error", "destructive"],
    ["warning", "accent"],
    ["info", "secondary-foreground"],
    ["action", "primary"],
  ] as const;

  for (const theme of ["light", "dark"] as const) {
    await page.locator("html").evaluate((element, currentTheme) => {
      element.dataset.theme = currentTheme;
      element.classList.toggle("dark", currentTheme === "dark");
      element.style.colorScheme = currentTheme;
    }, theme);

    const colors = await viewport.evaluate((element, pairs) => {
      const toastStyles = getComputedStyle(element);
      const rootStyles = getComputedStyle(document.documentElement);
      return pairs.map(([state, token]) => [
        toastStyles.getPropertyValue(`--sileo-state-${state}`).trim(),
        rootStyles.getPropertyValue(`--${token}`).trim(),
      ]);
    }, tokenPairs);

    for (const [toastColor, themeColor] of colors) {
      expect(toastColor).toBe(themeColor);
    }
  }
});
