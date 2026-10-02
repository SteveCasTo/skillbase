import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test("instructor lifecycle confirmation and mutations remain available without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    const page = await context.newPage();
    await page.goto("/app/instructores/nuevo");
    await page.getByLabel("Nombre", { exact: true }).fill("Fallback");
    await page.getByLabel("Apellidos").fill("Sintético");
    await page
      .getByLabel("Correo electrónico")
      .fill(`fallback-lifecycle-${randomUUID()}@e2e.test`);
    await page
      .getByLabel("Contraseña inicial", { exact: true })
      .fill(randomBytes(24).toString("base64url"));
    await page
      .getByRole("button", { name: "Crear instructor", exact: true })
      .click();
    await expect(page).toHaveURL(/\/editar\?success=saved$/u);
    const panel = page.locator("[data-instructor-lifecycle]");
    await panel.getByText("Desactivar instructor", { exact: true }).click();
    await panel
      .getByRole("button", {
        name: "Confirmar desactivar instructor",
        exact: true,
      })
      .click();
    await expect(
      panel.getByText("Cuenta desactivada", { exact: true }),
    ).toBeVisible();
    await panel.getByText("Activar instructor", { exact: true }).click();
    await panel
      .getByRole("button", {
        name: "Confirmar activar instructor",
        exact: true,
      })
      .click();
    await expect(
      panel.getByText("Cuenta activa", { exact: true }),
    ).toBeVisible();
    await panel.getByText("Eliminar instructor", { exact: true }).click();
    await panel
      .getByRole("button", {
        name: "Confirmar eliminar instructor",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/app\/instructores\?success=deleted$/u);
  } finally {
    await context.close();
  }
});

test("ADMIN lifecycle preserves credentials on reactivation, denies existing sessions and removes unused accounts", async ({
  context,
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/instructores/nuevo");
  const email = `lifecycle-${randomUUID()}@e2e.test`;
  const password = randomBytes(24).toString("base64url");
  await page.getByLabel("Nombre", { exact: true }).fill("Lifecycle");
  await page.getByLabel("Apellidos").fill("Sintético");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña inicial", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Crear instructor", exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/app\/instructores\/[0-9a-f-]+\/editar\?success=saved$/u,
  );
  const endpoint = new URL(page.url()).pathname;
  const instructorContext = await browser.newContext();
  try {
    const instructor = await instructorContext.newPage();
    await instructor.goto("/login");
    await instructor
      .getByLabel("Correo electrónico", { exact: true })
      .fill(email);
    await instructor.getByLabel("Contraseña", { exact: true }).fill(password);
    await instructor
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await expect(instructor).toHaveURL(/\/app$/u);
    const panel = page.locator("[data-instructor-lifecycle]");
    await expect(panel).toHaveAttribute("data-ready", "true");
    const deactivate = panel
      .locator("summary")
      .filter({ hasText: /^Desactivar instructor$/u });
    await deactivate.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Desactivar instructor" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(deactivate).toBeFocused();
    await deactivate.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirmar", exact: true })
      .click();
    await expect(page).toHaveURL(
      `${new URL(page.url()).origin}${endpoint}?success=deactivate`,
    );
    await expect(
      panel.getByText("Cuenta desactivada", { exact: true }),
    ).toBeVisible();
    await instructor.goto("/app/perfil");
    await expect(instructor).toHaveURL(/\/unauthorized\?reason=disabled$/u);
    // A fresh password login is a separate assertion from the existing-session denial above.
    await instructorContext.clearCookies();
    await panel.getByText("Activar instructor", { exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirmar", exact: true })
      .click();
    await expect(page).toHaveURL(
      `${new URL(page.url()).origin}${endpoint}?success=activate`,
    );
    await instructor.goto("/login");
    await instructor
      .getByLabel("Correo electrónico", { exact: true })
      .fill(email);
    await instructor.getByLabel("Contraseña", { exact: true }).fill(password);
    await instructor
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await expect(instructor).toHaveURL(/\/app$/u);
    await panel.getByText("Eliminar instructor", { exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirmar", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/instructores\?success=deleted$/u);
    await expect(
      page.getByRole("status").filter({ hasText: "Instructor eliminado" }),
    ).toBeVisible();
    await instructor.goto("/app");
    await expect(instructor).toHaveURL(/\/login(?:\?|$)/u);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await instructorContext.close();
  }
});

test("instructor lifecycle preserves inline error and shows pending feedback without submitting twice", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/instructores/nuevo");
  await page.getByLabel("Nombre", { exact: true }).fill("Pending");
  await page.getByLabel("Apellidos").fill("Sintético");
  await page
    .getByLabel("Correo electrónico")
    .fill(`pending-${randomUUID()}@e2e.test`);
  await page
    .getByLabel("Contraseña inicial", { exact: true })
    .fill(randomBytes(24).toString("base64url"));
  await page
    .getByRole("button", { name: "Crear instructor", exact: true })
    .click();
  await expect(page).toHaveURL(/\/editar\?success=saved$/u);
  const panel = page.locator("[data-instructor-lifecycle]");
  await expect(panel).toHaveAttribute("data-ready", "true");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/app/instructores/*/editar", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests++;
    await gate;
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: "El perfil cambió. Recarga antes de continuar.",
      }),
    });
  });
  await panel.getByText("Desactivar instructor", { exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  await expect(panel).toHaveAttribute("aria-busy", "true");
  release();
  await expect(panel.locator("[data-lifecycle-error]")).toHaveText(
    "El perfil cambió. Recarga antes de continuar.",
  );
  await expect(panel.locator("[data-lifecycle-error]")).toBeFocused();
  await expect(panel).not.toHaveAttribute("aria-busy", "true");
  expect(requests).toBe(1);
});
