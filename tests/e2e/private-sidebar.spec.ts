import { expect, test } from "@playwright/test";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test("desktop sidebar respects roles and marks nested courses and formats", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.multiRole.email);
  await page.goto("/app/formatos");
  const nav = page.getByRole("navigation", { name: "Navegación privada" });
  await expect(nav.getByRole("link", { name: "Formatos" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: "Cursos" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Asistencia" })).toBeVisible();
  await nav.getByRole("link", { name: "Cursos" }).click();
  await expect(nav.getByRole("link", { name: "Cursos" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("collapsed rail expands on hover without shifting main and persists across navigation", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app");
  const shell = page.locator("[data-private-shell]");
  const sidebar = page.locator(".private-sidebar");
  const collapseButton = page.getByRole("button", {
    name: "Contraer barra lateral",
  });
  const logoutButton = sidebar.locator(
    ".private-sidebar-footer .private-sidebar-actions form button",
  );
  const collapseBox = await collapseButton.boundingBox();
  const logoutBox = await logoutButton.boundingBox();
  expect(collapseBox).not.toBeNull();
  expect(logoutBox).not.toBeNull();
  expect(Math.abs(collapseBox!.y - logoutBox!.y)).toBeLessThan(2);
  await expect(collapseButton).toHaveText("");
  await expect(logoutButton).toHaveText("");
  expect(
    await shell.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toContain("0.35s");
  await expect(sidebar.getByText("Espacio de trabajo")).toHaveCount(0);
  await collapseButton.click();
  await expect(shell).toHaveAttribute("data-collapsed", "true");
  await page.waitForFunction(() =>
    [
      document.querySelector("[data-private-shell]"),
      document.querySelector(".private-sidebar-panel"),
    ].every(
      (element) =>
        !element ||
        element
          .getAnimations()
          .every((animation) => animation.playState !== "running"),
    ),
  );
  await expect(logoutButton).toBeHidden();
  expect(
    await logoutButton.evaluate(
      (element) => element !== document.activeElement,
    ),
  ).toBe(true);
  await expect(sidebar.getByText("Expandir menú")).toHaveCount(0);
  const brand = await sidebar.locator(".private-brand").boundingBox();
  const firstLink = await sidebar
    .locator(".private-nav-list a")
    .first()
    .boundingBox();
  expect(brand).not.toBeNull();
  expect(firstLink).not.toBeNull();
  expect(firstLink!.y - (brand!.y + brand!.height)).toBeLessThan(24);
  await expect(
    page
      .getByRole("navigation", { name: "Navegación privada" })
      .locator(".private-parent-active"),
  ).toHaveCount(0);
  const main = page.locator(".private-main-scroll");
  const railWidth = (await main.boundingBox())?.width;
  await main.hover();
  await page.locator(".private-brand-mark").hover();
  await expect(shell).toHaveAttribute("data-preview", "true");
  await expect(logoutButton).toBeVisible();
  expect((await main.boundingBox())?.width).toBe(railWidth);
  await page.locator(".private-main-scroll").hover();
  await expect(shell).not.toHaveAttribute("data-preview", "true");
  await page.locator(".private-brand-mark").hover();
  await page
    .getByRole("navigation", { name: "Navegación privada" })
    .getByRole("link", { name: "Formatos" })
    .click();
  await expect(shell).toHaveAttribute("data-collapsed", "true");
  const activeGroup = page
    .getByRole("navigation", { name: "Navegación privada" })
    .locator(".private-parent-active");
  await page.locator(".private-main-scroll").hover();
  const activeColor = await activeGroup.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const inactiveColor = await page
    .getByRole("navigation", { name: "Navegación privada" })
    .getByRole("link", { name: "Resumen" })
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(activeColor).not.toBe(inactiveColor);
  await expect(
    page.getByRole("button", { name: "Expandir barra lateral" }),
  ).toBeVisible();
  await expect(logoutButton).toBeHidden();
});

test("keyboard focus previews rail, Escape closes it; instructor sees no admin links", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto("/app");
  const shell = page.locator("[data-private-shell]");
  const nav = page.getByRole("navigation", { name: "Navegación privada" });
  await expect(nav.getByRole("link", { name: "Cursos" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Asistencia" })).toBeVisible();
  await page.getByRole("button", { name: "Contraer barra lateral" }).click();
  await page.locator(".private-main-scroll").hover();
  await page.keyboard.press("Shift+Tab");
  await expect(shell).toHaveAttribute("data-preview", "true");
  await expect(
    page.getByRole("button", { name: "Cerrar sesión" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shell).not.toHaveAttribute("data-preview", "true");
  await expect(
    page.getByRole("button", { name: "Cerrar sesión" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Expandir barra lateral" }),
  ).toBeFocused();
});

test("desktop content scrolls independently of the sidebar and reduced motion removes the preview animation", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app");
  await page.evaluate(() => {
    const main = document.querySelector("#main-content");
    if (main)
      main.insertAdjacentHTML(
        "beforeend",
        '<div style="height: 2000px" aria-hidden="true"></div>',
      );
  });
  const scroller = page.locator(".private-main-scroll");
  await scroller.evaluate((element) => {
    element.scrollTop = 400;
  });
  expect(
    await scroller.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  expect(
    await page
      .locator(".private-sidebar .private-nav")
      .evaluate((element) => element.scrollTop),
  ).toBe(0);
  await page.getByRole("button", { name: "Contraer barra lateral" }).click();
  await scroller.hover();
  await page.locator(".private-brand-mark").hover();
  await expect(page.locator("[data-private-shell]")).toHaveAttribute(
    "data-preview",
    "true",
  );
  expect(
    await page
      .locator(".private-sidebar-panel")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  expect(
    await page
      .locator(".private-sidebar-panel")
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe("0s");
});
