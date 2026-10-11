import { expect, test, type Page } from "@playwright/test";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

function trackHydrationErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

for (const theme of ["light", "dark", "system"] as const) {
  test(`initial ${theme} toast mounts once without hydration errors and follows router theme`, async ({
    context,
    page,
  }) => {
    const errors = trackHydrationErrors(page);
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(
      (selected) => localStorage.setItem("theme", selected),
      theme,
    );
    await page.goto("/app/formatos?success=created");
    await expect(
      page.locator('astro-island[component-export="SileoHost"]'),
    ).toHaveCount(1);
    await expect(page.locator("[data-sileo-viewport]")).toHaveCount(1);
    await expect(
      page.locator("[data-sileo-toast]").filter({ hasText: "Formato creado" }),
    ).toContainText("Formato creado");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("[data-sileo-viewport]")).toHaveAttribute(
      "data-position",
      "bottom-right",
    );
    await expect(page.locator("[data-sileo-viewport]")).toHaveAttribute(
      "data-theme",
      theme === "system" ? "dark" : theme,
    );
    const link = page
      .getByRole("navigation", { name: "Navegación privada" })
      .getByRole("link", { name: "Cursos", exact: true });
    await link.evaluate((element) =>
      element.setAttribute("href", "/app/cursos?success=created"),
    );
    await link.click();
    await expect(
      page
        .locator("[data-sileo-toast]")
        .filter({ hasText: "Curso creado como borrador." }),
    ).toContainText("Curso creado como borrador.");
    await expect(
      page.locator('astro-island[component-export="SileoHost"]'),
    ).toHaveCount(1);
    await expect(page.locator("[data-sileo-viewport]")).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const resolved = theme === "system" ? "dark" : theme;
    await expect(page.locator("[data-sileo-viewport]")).toHaveAttribute(
      "data-theme",
      resolved,
    );
    expect(errors).toEqual([]);
  });
}

test("private success toast uses semantic theme colors in light and dark modes", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/formatos?success=created");
  await expect(
    page.locator("[data-sileo-toast]").filter({ hasText: "Formato creado" }),
  ).toContainText("Formato creado");

  const viewport = page.locator("[data-sileo-viewport]");
  const tokenPairs = [
    ["success", "feedback-success"],
    ["loading", "muted-foreground"],
    ["error", "destructive"],
    ["warning", "feedback-warning"],
    ["info", "feedback-info"],
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
      .filter({ hasText: "Formato creado" })
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

test("private toast placement leaves top-right page actions clickable", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/formatos");
  await page.evaluate(async () => {
    const moduleUrl = performance
      .getEntriesByType("resource")
      .find((entry) =>
        /\/src\/lib\/notifications\.ts(?:\?|$)/.test(entry.name),
      )?.name;
    if (!moduleUrl) throw new Error("Page notifications facade was not loaded");
    const { notifications }: typeof import("../../src/lib/notifications") =
      await import(moduleUrl);
    notifications.success({
      title: "Aviso persistente de prueba",
      duration: 60000,
    });

    const action = document.createElement("button");
    action.type = "button";
    action.textContent = "Acción superior derecha";
    action.style.cssText =
      "position:fixed;top:12px;right:12px;z-index:49;min-height:44px";
    action.addEventListener("click", () => {
      action.textContent = "Acción completada";
    });
    document.body.append(action);
  });

  await expect(
    page
      .locator("[data-sileo-toast]")
      .filter({ hasText: "Aviso persistente de prueba" }),
  ).toBeVisible();
  await expect(page.locator("[data-sileo-viewport]")).toHaveAttribute(
    "data-position",
    "bottom-right",
  );
  await page.getByRole("button", { name: "Acción superior derecha" }).click();
  await expect(
    page.getByRole("button", { name: "Acción completada" }),
  ).toBeVisible();
  await expect(
    page
      .locator("[data-sileo-toast]")
      .filter({ hasText: "Aviso persistente de prueba" }),
  ).toBeVisible();
});

test("independent early notifications survive delayed hydration, concurrent loading updates and theme toggles", async ({
  context,
  page,
}) => {
  const errors = trackHydrationErrors(page);
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/*SileoHost*", async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.goto("/app/formatos?success=created", {
      waitUntil: "domcontentloaded",
    });
    // The page consumes the parameter after emitting its real facade success.
    await expect(page).toHaveURL(/\/app\/formatos$/);
    await page.evaluate(async () => {
      // Reuse the facade module imported by the real page, sharing its Sileo store.
      const moduleUrl = performance
        .getEntriesByType("resource")
        .find((entry) =>
          /\/src\/lib\/notifications\.ts(?:\?|$)/.test(entry.name),
        )?.name;
      if (!moduleUrl)
        throw new Error("Page notifications facade was not loaded");
      const { notifications }: typeof import("../../src/lib/notifications") =
        await import(moduleUrl);
      void notifications.promise(
        new Promise<void>((resolve) =>
          Object.assign(window, { finishFirstEarlyNotification: resolve }),
        ),
        {
          loading: { title: "Operación temprana cargando" },
          success: { title: "Operación temprana completada", duration: 60000 },
          error: { title: "Error temprano" },
        },
      );
      void notifications.promise(
        new Promise<void>((resolve) =>
          Object.assign(window, { finishEarlyNotification: resolve }),
        ),
        {
          loading: { title: "Segunda operación cargando" },
          success: { title: "Segunda operación completada", duration: 60000 },
          error: { title: "Error de segunda operación" },
        },
      );
    });
    await expect(page.locator("[data-sileo-toast]")).toHaveCount(0);
  } finally {
    release();
  }
  const toast = page
    .locator("[data-sileo-toast]")
    .filter({ hasText: "Formato creado" });
  await expect(toast).toContainText("Formato creado");
  await expect(page.locator("[data-sileo-viewport]")).toHaveCount(1);
  await expect(page.locator("[data-sileo-viewport]")).toHaveAttribute(
    "data-position",
    "bottom-right",
  );
  await expect(
    page
      .locator("[data-sileo-toast]")
      .filter({ hasText: "Operación temprana cargando" }),
  ).toHaveCount(1);
  await page
    .locator("[data-sileo-toast]")
    .filter({ hasText: "Operación temprana cargando" })
    .evaluate((element) => Object.assign(window, { firstEarlyToast: element }));
  await page
    .locator("[data-sileo-toast]")
    .filter({ hasText: "Segunda operación cargando" })
    .evaluate((element) =>
      Object.assign(window, { secondEarlyToast: element }),
    );
  await page.evaluate(() => {
    (
      window as typeof window & { finishFirstEarlyNotification: () => void }
    ).finishFirstEarlyNotification();
  });
  const firstSuccess = page
    .locator("[data-sileo-toast]")
    .filter({ hasText: "Operación temprana completada" });
  await expect(firstSuccess).toHaveAttribute("data-state", "success");
  expect(
    await firstSuccess.evaluate(
      (element) =>
        (window as typeof window & { firstEarlyToast: Element })
          .firstEarlyToast === element,
    ),
  ).toBe(true);
  await expect(
    page
      .locator("[data-sileo-toast]")
      .filter({ hasText: "Segunda operación cargando" }),
  ).toHaveAttribute("data-state", "loading");
  await expect(
    page
      .locator("[data-sileo-toast]")
      .filter({ hasText: "Segunda operación cargando" }),
  ).toHaveCount(1);
  const secondSuccess = page
    .locator("[data-sileo-toast]")
    .filter({ hasText: "Segunda operación completada" });
  await page.evaluate(() => {
    (
      window as typeof window & { finishEarlyNotification: () => void }
    ).finishEarlyNotification();
  });
  await expect(
    page
      .locator("[data-sileo-toast]")
      .filter({ hasText: "Segunda operación completada" }),
  ).toHaveCount(1);
  await expect(secondSuccess).toHaveAttribute("data-state", "success");
  expect(
    await secondSuccess.evaluate(
      (element) =>
        (window as typeof window & { secondEarlyToast: Element })
          .secondEarlyToast === element,
    ),
  ).toBe(true);
  await expect(firstSuccess).toHaveCount(1);
  await page
    .locator(".private-sidebar")
    .getByRole("button", { name: "Cambiar a modo claro" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(firstSuccess).toContainText("Operación temprana completada");
  await page
    .getByRole("navigation", { name: "Navegación privada" })
    .getByRole("link", { name: "Cursos", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/cursos$/);
  await expect(page.locator("[data-sileo-viewport]")).toHaveCount(1);
  await expect(page.locator("[data-sileo-viewport]")).toHaveAttribute(
    "data-position",
    "bottom-right",
  );
  for (const [notice, stored] of [
    [firstSuccess, "firstEarlyToast"],
    [secondSuccess, "secondEarlyToast"],
  ] as const) {
    await expect(notice).toHaveCount(1);
    expect(
      await notice.evaluate(
        (element, key) => Reflect.get(window, key) === element,
        stored,
      ),
    ).toBe(true);
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page
    .locator(".private-sidebar")
    .getByRole("button", { name: "Cambiar a modo oscuro" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.locator('astro-island[component-export="SileoHost"]'),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("theme storage removal and clear reset to each surface default, unrelated keys do not", async ({
  context,
  page,
}) => {
  const errors = trackHydrationErrors(page);
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/app");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: "unrelated", newValue: "light" }),
    ),
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: "theme", newValue: null }),
    ),
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await page
    .locator(".private-sidebar")
    .getByRole("button", { name: "Cambiar a modo oscuro" })
    .click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: null, newValue: null }),
    ),
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await page.goto("/");
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: "theme", newValue: null }),
    ),
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(errors).toEqual([]);
});

for (const selected of ["light", "dark"] as const) {
  test(`blocked theme storage preserves ${selected} in memory before and after router swaps`, async ({
    context,
    page,
  }) => {
    const errors = trackHydrationErrors(page);
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    await page.emulateMedia({
      colorScheme: selected === "dark" ? "light" : "dark",
    });
    await page.addInitScript(() => {
      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        if (key === "theme") throw new DOMException("Blocked", "SecurityError");
        return getItem.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (key === "theme") throw new DOMException("Blocked", "SecurityError");
        return setItem.call(this, key, value);
      };
    });
    await page.goto("/app");
    await page
      .locator(".private-sidebar")
      .getByRole("button", {
        name:
          selected === "dark"
            ? "Cambiar a modo oscuro"
            : "Cambiar a modo claro",
      })
      .click();
    await page.evaluate(() => {
      const observed: string[] = [];
      Object.assign(window, { observedThemeSwaps: observed });
      document.addEventListener("astro:before-swap", (event) =>
        observed.push(
          event.newDocument.documentElement.dataset.theme ?? "missing",
        ),
      );
      document.addEventListener("astro:after-swap", () =>
        observed.push(document.documentElement.dataset.theme ?? "missing"),
      );
    });
    const navigation = page.getByRole("navigation", {
      name: "Navegación privada",
    });
    await navigation.getByRole("link", { name: "Formatos" }).click();
    await expect(page).toHaveURL(/\/app\/formatos$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", selected);
    await navigation.getByRole("link", { name: "Resumen" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", selected);
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { observedThemeSwaps: string[] })
            .observedThemeSwaps,
      ),
    ).toEqual([selected, selected, selected, selected]);
    await expect(
      page.locator('astro-island[component-export="SileoHost"]'),
    ).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test("private toast host persists across client-side navigation", async ({
  context,
  page,
}) => {
  const errors = trackHydrationErrors(page);
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/formatos?success=created");

  // Sileo only renders a viewport while it has an active toast.
  await expect(
    page.locator("[data-sileo-toast]").filter({ hasText: "Formato creado" }),
  ).toContainText("Formato creado");

  const viewport = page.locator("[data-sileo-viewport]");
  await expect(viewport).toHaveCount(1);
  await expect(viewport).toHaveAttribute("data-position", "bottom-right");
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

  await expect(
    page
      .locator("[data-sileo-toast]")
      .filter({ hasText: "Curso creado como borrador." }),
  ).toContainText("Curso creado como borrador.");
  await expect(viewport).toHaveCount(1);
  await expect(viewport).toHaveAttribute("data-position", "bottom-right");
  expect(
    await viewport.evaluate(
      (element) =>
        (window as typeof window & { toastViewport?: Element })
          .toastViewport === element,
    ),
  ).toBe(true);
  await expect(
    page.locator('astro-island[component-export="SileoHost"]'),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});
