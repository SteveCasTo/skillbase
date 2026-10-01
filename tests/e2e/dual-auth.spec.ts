import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
const fixture = AUTH_FIXTURES.passwordAdmin;
const replacement = "Synthetic-Replacement-Password-2026";

test("email login, keyboard password toggle, own profile and secure password change", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill(fixture.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(fixture.password);
  await expect(
    page.getByRole("button", { name: "Mostrar contraseña", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Mostrar contraseña", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL("/app");
  await page
    .getByRole("link", { name: "Mi perfil", exact: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Mi perfil" })).toBeVisible();
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(replacement);
  await page
    .getByLabel("Confirmar nueva contraseña", { exact: true })
    .fill(replacement);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Confirma tu contraseña actual",
  );
  await page
    .getByLabel("Contraseña actual (si tienes una)", { exact: true })
    .fill(fixture.password);
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(replacement);
  await page
    .getByLabel("Confirmar nueva contraseña", { exact: true })
    .fill(replacement);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Contraseña actualizada",
  );
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill(fixture.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(replacement);
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL("/app");
});

test("login and profile work without JavaScript and do not overflow on mobile", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: baseURL!,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const fixture = AUTH_FIXTURES.passwordInstructor;
  await page.goto("/login");
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill(fixture.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(fixture.password);
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL("/app");
  await page.goto("/app/perfil");
  await expect(page.getByRole("heading", { name: "Mi perfil" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByLabel("Contraseña actual (si tienes una)", { exact: true })
    .fill(fixture.password);
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(replacement);
  await page
    .getByLabel("Confirmar nueva contraseña", { exact: true })
    .fill(replacement);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Guardar contraseña" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText(
    "Contraseña actualizada",
  );
  await page.goto("/app/asistencia");
  await expect(page).toHaveURL(/\/unauthorized\?reason=forbidden$/u);
  await context.close();
});

test("forgot password is confidential; invalid redirect, origin, passwords and recovery proof fail safely", async ({
  page,
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  for (const action of ["password", "forgot-password", "link-google"]) {
    const response = await request.post(`/auth/${action}`, {
      headers: { origin: "https://evil.example" },
      data: { email: fixture.email, password: "wrong" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
  }
  for (const email of ["unknown@example.test", fixture.email]) {
    const response = await request.post("/auth/forgot-password", {
      headers: { origin },
      form: { email, next: "https://evil.example" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe("/login?status=recovery_sent");
  }
  const response = await request.post("/auth/password", {
    headers: { origin },
    form: {
      email: fixture.email,
      password: "wrong",
      next: "https://evil.example",
    },
    maxRedirects: 0,
  });
  expect(response.headers().location).toBe("/login?error=credentials");
  await page.goto("/auth/recovery?code=invalid");
  await expect(page).toHaveURL("/login?error=recovery");
  await expect(page.getByRole("alert")).not.toContainText("wrong");
});

test.afterAll(async () => {
  const environment = getTestSupabaseEnvironment();
  const provider = createClient(
    environment.apiUrl,
    environment.serviceRoleKey,
    { auth: { persistSession: false } },
  );
  const { data } = await provider.auth.admin.listUsers();
  for (const fixture of [
    AUTH_FIXTURES.passwordAdmin,
    AUTH_FIXTURES.passwordInstructor,
  ]) {
    const user = data.users.find((entry) => entry.email === fixture.email);
    if (user)
      await provider.auth.admin.updateUserById(user.id, {
        password: fixture.password,
      });
  }
});
