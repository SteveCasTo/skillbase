import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

async function createAccount(page: Page) {
  const name = `Administrador sintético ${randomUUID()}`;
  const email = `admin-interface-${randomUUID()}@e2e.test`;
  const password = randomBytes(24).toString("base64url");
  await page.goto("/app/administradores/nuevo");
  await expect(page.locator("[data-admin-create]")).toHaveAttribute(
    "data-bound",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Crear administrador", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByLabel("Contraseña inicial", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Crear administrador", exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/app\/administradores\/[0-9a-f-]+\?success=saved$/u,
  );
  expect(await page.content()).not.toContain(password);
  return { name, email, password, endpoint: new URL(page.url()).pathname };
}
async function confirmAction(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: label, exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Volver", exact: true }),
  ).toBeFocused();
  const action = dialog.getByRole("button", { name: label, exact: true });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: label, exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await action.click();
}
async function loginPassword(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app$/u);
}

test("ADMIN creates, independently renames and deletes an unused ADMIN from its mobile card", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const account = await createAccount(page);
  const nameForm = page.getByRole("form", {
    name: "Editar nombre",
    exact: true,
  });
  await expect(nameForm).toHaveAttribute("data-bound", "true");
  await nameForm
    .getByRole("button", { name: "Editar nombre", exact: true })
    .click();
  await expect(
    nameForm.getByRole("button", { name: "Guardar nombre", exact: true }),
  ).toBeDisabled();
  const updated = `${account.name} actualizado`;
  await nameForm.getByLabel("Nombre", { exact: true }).fill(updated);
  await nameForm
    .getByRole("button", { name: "Guardar nombre", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: updated, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: updated, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Correo electrónico" }),
  ).toHaveCount(0);
  await page.goto("/app/administradores");
  await page
    .getByRole("searchbox", { name: "Buscar por nombre o correo" })
    .fill(account.email);
  const card = page.getByRole("link", {
    name: `${updated} ${account.email} Cuenta activa`,
    exact: true,
  });
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${account.endpoint}$`, "u"));
  await confirmAction(page, "Eliminar administrador");
  await expect(page).toHaveURL(/\/app\/administradores\?success=deleted$/u);
  await expect(
    page.getByRole("link", { name: new RegExp(account.email, "u") }),
  ).toHaveCount(0);
});

test("the server's last-active ADMIN projection keeps delete and deactivate visible but disabled", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const account = await createAccount(page);
  const targetId = account.endpoint.split("/").at(-1)!;
  const database = createDatabase(getTestSupabaseEnvironment().databaseUrl);
  const active = await database.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
    .where(
      and(
        eq(schema.users.status, "ACTIVE"),
        eq(schema.userRoles.roleCode, "ADMIN"),
      ),
    );
  const others = active.map(({ id }) => id).filter((id) => id !== targetId);
  try {
    await database.db
      .update(schema.users)
      .set({ status: "DISABLED" })
      .where(inArray(schema.users.id, others));
    await context.clearCookies();
    await loginPassword(page, account.email, account.password);
    await page.goto("/app/administradores");
    await page
      .getByRole("searchbox", { name: "Buscar por nombre o correo" })
      .fill(account.email);
    await page
      .getByRole("link", {
        name: `${account.name} ${account.email} Cuenta activa`,
        exact: true,
      })
      .click();
    const reason = "Debe quedar al menos un administrador activo.";
    const remove = page.getByRole("button", {
      name: `Eliminar administrador: ${reason}`,
      exact: true,
    });
    await expect(remove).toBeVisible();
    await expect(remove).toBeDisabled();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const form = page.getByRole("form", { name: "Editar nombre", exact: true });
    await form
      .getByRole("button", { name: "Editar nombre", exact: true })
      .click();
    await form
      .getByLabel("Nombre", { exact: true })
      .fill(`${account.name} usado`);
    await form
      .getByRole("button", { name: "Guardar nombre", exact: true })
      .click();
    const deactivate = page.getByRole("button", {
      name: `Desactivar administrador: ${reason}`,
      exact: true,
    });
    await expect(deactivate).toBeVisible();
    await expect(deactivate).toBeDisabled();
    await page.reload();
    await expect(deactivate).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await database.db
      .update(schema.users)
      .set({ status: "ACTIVE" })
      .where(inArray(schema.users.id, others));
    await database.close();
  }
});

test("used ADMIN self-deactivation ends its session and another equal ADMIN reactivates without changing credentials", async ({
  context,
  page,
  browser,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const account = await createAccount(page);
  const ownContext = await browser.newContext();
  try {
    const own = await ownContext.newPage();
    await loginPassword(own, account.email, account.password);
    await own.goto(account.endpoint);
    const nameForm = own.getByRole("form", {
      name: "Editar nombre",
      exact: true,
    });
    await expect(nameForm).toHaveAttribute("data-bound", "true");
    await nameForm
      .getByRole("button", { name: "Editar nombre", exact: true })
      .click();
    await nameForm
      .getByLabel("Nombre", { exact: true })
      .fill(`${account.name} usado`);
    await nameForm
      .getByRole("button", { name: "Guardar nombre", exact: true })
      .click();
    // The returned DTO changes the applicable action immediately, with no client business-rule guess.
    await expect(
      own.getByRole("button", {
        name: "Desactivar administrador",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      own.getByRole("button", { name: "Eliminar administrador", exact: true }),
    ).toHaveCount(0);
    await confirmAction(own, "Desactivar administrador");
    await expect(own).toHaveURL(/\/login$/u);
    await own.goto("/app/perfil");
    await expect(own).not.toHaveURL(/\/app\/perfil$/u);
    await page.goto(account.endpoint);
    await expect(
      page.getByText("Cuenta desactivada", { exact: true }),
    ).toBeVisible();
    await confirmAction(page, "Reactivar administrador");
    await expect(
      page.getByText("Cuenta activa", { exact: true }),
    ).toBeVisible();
    await ownContext.clearCookies();
    await loginPassword(own, account.email, account.password);
    await own.goto("/app/administradores");
    await expect(
      own.getByRole("link", { name: "Crear administrador", exact: true }),
    ).toBeVisible();
  } finally {
    await ownContext.close();
  }
});
