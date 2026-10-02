import { expect, test } from "@playwright/test";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test("mobile private navigation exposes authorized multi-role destinations", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.mobileMultiRole.email);
  await page.goto("/app");
  const triggerBox = await page.getByLabel("Abrir menú").boundingBox();
  const brandBox = await page.locator(".private-mobile-header a").boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(brandBox).not.toBeNull();
  expect(triggerBox!.x).toBeLessThan(brandBox!.x);
  await page.getByLabel("Abrir menú").click();
  const navigation = page.getByRole("navigation", { name: "Navegación móvil" });
  await expect(page.getByRole("dialog", { name: "SkillBase" })).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Cursos", exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Formatos" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Asistencia" }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Mi perfil" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Mi perfil" }),
  ).toBeVisible();
});

test("mobile drawer closes with Escape and restores keyboard focus", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto("/app");
  const trigger = page.getByRole("button", { name: "Abrir menú" });
  await trigger.click();
  const navigation = page.getByRole("navigation", { name: "Navegación móvil" });
  await expect(
    navigation.getByRole("link", { name: "Asistencia" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "Mi perfil" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Cursos", exact: true }),
  ).toHaveCount(0);
  await expect(
    navigation.getByRole("link", { name: "Mis cursos", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-mobile-drawer]")).toBeHidden();
});

test("mobile menu slides in and out, with theme on the left and logout on the right", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app");
  const trigger = page.getByRole("button", { name: "Abrir menú" });
  const drawer = page.locator("[data-mobile-drawer]");
  const panel = page.locator(".private-mobile-panel");
  await trigger.click();
  await expect(drawer).toHaveAttribute("data-state", "open");
  expect(
    await panel.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toBe("0.3s");

  const footer = page.locator(".private-mobile-footer");
  const logout = footer.getByRole("button", { name: "Cerrar sesión" });
  const positions = await logout.evaluate((element) => {
    const footer = element.closest(".private-mobile-footer")!;
    const footerBox = footer.getBoundingClientRect();
    const logoutBox = element.getBoundingClientRect();
    return {
      logoutX: logoutBox.x,
      footerCenter: footerBox.x + footerBox.width / 2,
      footerWidth: footerBox.width,
      logoutWidth: logoutBox.width,
    };
  });
  expect(positions.footerWidth).toBeGreaterThan(0);
  expect(positions.logoutWidth).toBeGreaterThan(0);
  expect(positions.logoutX).toBeGreaterThan(positions.footerCenter);

  await page.getByRole("button", { name: "Cerrar menú" }).click();
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(panel).toBeVisible();
});

test("mobile drawer respects reduced motion", async ({ context, page }) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app");
  await page.getByRole("button", { name: "Abrir menú" }).click();
  expect(
    await page
      .locator(".private-mobile-panel")
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe("0s");
  await page.getByRole("button", { name: "Cerrar menú" }).click();
  await expect(page.locator("[data-mobile-drawer]")).toBeHidden();
});

test("mobile footer toggles the resolved system theme and remains usable after router navigation", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/app");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await page.getByRole("button", { name: "Abrir menú" }).click();
  const footer = page.locator(".private-mobile-footer");
  await footer.getByRole("button", { name: "Cambiar a modo claro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page
    .getByRole("navigation", { name: "Navegación móvil" })
    .getByRole("link", { name: "Formatos" })
    .click();
  await expect(page).toHaveURL(/\/app\/formatos$/);
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await footer.getByRole("button", { name: "Cambiar a modo oscuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Cerrar menú" }).click();
  await expect(page.getByRole("button", { name: "Abrir menú" })).toBeFocused();
});

test("mobile navigation closes its drawer while the real next page skeleton loads", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/app/formatos", async (route) => {
    const response = await route.fetch();
    await pending;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Abrir menú" }).click();
    await page
      .getByRole("navigation", { name: "Navegación móvil" })
      .getByRole("link", { name: "Formatos" })
      .click();
    await expect(page.locator("[data-mobile-drawer]")).toBeHidden();
    await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator("[data-navigation-skeleton]")).toBeVisible();
  } finally {
    release();
  }
  await expect(page).toHaveURL(/\/app\/formatos$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("[data-navigation-skeleton]")).toBeHidden();
});

test("failed or cancelled keyboard navigation from the mobile drawer restores trigger focus", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app");
  const trigger = page.getByRole("button", { name: "Abrir menú" });
  for (const cancel of [false, true]) {
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("navigation", { name: "Navegación móvil" })
      .getByRole("link", { name: "Formatos" })
      .focus();
    await page.evaluate(async (abort) => {
      const controller = new AbortController();
      const event = Object.assign(new Event("astro:before-preparation"), {
        to: new URL("/app/formatos", location.href),
        signal: controller.signal,
        formData: undefined,
        loader: async () => {
          if (abort) controller.abort();
          else throw new Error("Controlled mobile load failure");
        },
      });
      document.dispatchEvent(event);
      await event.loader().catch(() => {});
    }, cancel);
    await expect(trigger).toBeFocused();
    await expect(page.locator("[data-mobile-drawer]")).toBeHidden();
    await expect(page.locator("[data-navigation-skeleton]")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});
