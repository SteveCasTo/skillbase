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
    const surface = await page
      .locator("[data-sileo-toast]")
      .evaluate((toast) => {
        const rect = toast.querySelector<SVGRectElement>("[data-sileo-pill]");
        const title = toast.querySelector<HTMLElement>("[data-sileo-title]");
        if (!rect || !title) throw new Error("Toast surface not found");
        const sample = document.createElement("div");
        sample.style.backgroundColor = "var(--card)";
        document.body.append(sample);
        const card = getComputedStyle(sample).backgroundColor;
        sample.remove();
        return {
          fill: getComputedStyle(rect).fill,
          card,
          title: getComputedStyle(title).color,
          foreground: getComputedStyle(document.documentElement)
            .getPropertyValue("--card-foreground")
            .trim(),
        };
      });
    expect(surface.fill).toBe(surface.card);
    expect(surface.title).toBe(surface.foreground);
  }
});

test("private toast host persists across client-side navigation", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/formatos?success=created");

  // Sileo only renders a viewport while it has an active toast.
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Formato creado",
  );

  const viewport = page.locator("[data-sileo-viewport]");
  await expect(viewport).toBeAttached();
  await viewport.evaluate((element) => {
    (window as typeof window & { toastViewport?: Element }).toastViewport =
      element;
  });

  const coursesLink = page
    .getByRole("navigation", { name: "Navegación privada" })
    .getByRole("link", { name: "Cursos", exact: true });
  await coursesLink.evaluate((link) => {
    link.setAttribute("href", "/app/cursos?success=created");
  });
  await coursesLink.click();

  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Curso creado como borrador.",
  );
  expect(
    await viewport.evaluate(
      (element) =>
        (window as typeof window & { toastViewport?: Element })
          .toastViewport === element,
    ),
  ).toBe(true);
});
