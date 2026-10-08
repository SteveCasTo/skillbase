import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import {
  attachGoogleFixture,
  completeLinkProviderFixture,
} from "../fixtures/oauth-provider";
import {
  signInOAuthFixture,
  prepareBrowserRecoveryFixture,
  resetLoginNetworkBudgetFixture,
} from "./auth-helper";
import { createGoogleOnlyAdminFixture } from "../fixtures/google-only-admin";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
const environment = getTestSupabaseEnvironment();
const provider = createClient(environment.apiUrl, environment.serviceRoleKey, {
  auth: { persistSession: false },
});

test.beforeEach(resetLoginNetworkBudgetFixture);

async function authId(email: string): Promise<string> {
  const { data, error } = await provider.auth.admin.listUsers();
  const user = data.users.find((entry) => entry.email === email);
  if (error || !user) throw new Error("Association fixture is unavailable");
  return user.id;
}
async function login(
  page: Page,
  fixture: { email: string; password: string },
): Promise<void> {
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
}
async function startAssociation(
  context: BrowserContext,
  siteUrl: string,
): Promise<string> {
  const response = await context.request.post("/auth/link-google", {
    headers: { origin: new URL(siteUrl).origin },
    form: {},
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  let location = response.headers().location;
  expect(location).toBeTruthy();
  if (new URL(location!).origin === new URL(environment.apiUrl).origin) {
    // Only follow the local Auth authorize endpoint. Never visit Google UI.
    const authorize = await context.request.get(location!, { maxRedirects: 0 });
    expect(authorize.status()).toBe(302);
    location = authorize.headers().location;
  }
  expect(new URL(location!).hostname).toBe("accounts.google.com");
  return location!;
}

test("mismatched Google restores the owner; unsolicited attachment leaves password access; explicit confirmation enables Google", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const fixture = AUTH_FIXTURES.associationOwner;
  const id = await authId(fixture.email);
  await login(page, fixture);
  const badOrigin = await context.request.post("/auth/link-google", {
    headers: { origin: "https://evil.example" },
    data: {},
    maxRedirects: 0,
  });
  expect(badOrigin.status()).toBe(403);

  const mismatchedRedirect = await startAssociation(context, baseURL!);
  await attachGoogleFixture(id, "different@example.test");
  const mismatchedCode = await completeLinkProviderFixture(
    mismatchedRedirect,
    id,
  );
  await page.goto(`/auth/callback?code=${encodeURIComponent(mismatchedCode)}`);
  await expect(page).toHaveURL("/app/perfil?error=link");
  await expect(
    page
      .getByRole("form", { name: "Editar nombre" })
      .getByLabel("Nombre", { exact: true }),
  ).toHaveValue("Association");
  await expect(
    page
      .getByRole("form", { name: "Editar apellidos" })
      .getByLabel("Apellidos", { exact: true }),
  ).toHaveValue("Owner");
  await expect(
    page.getByRole("button", { name: "Asociar Google" }),
  ).toBeVisible();

  await attachGoogleFixture(id, fixture.email.toUpperCase());
  const googleContext = await browser.newContext({ baseURL: baseURL! });
  await signInOAuthFixture(googleContext, id);
  const googlePage = await googleContext.newPage();
  await googlePage.goto("/app");
  await expect(googlePage).toHaveURL("/unauthorized?reason=identity_conflict");
  await page.goto("/app/perfil");
  await expect(page.getByRole("heading", { name: "Mi perfil" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Asociar Google" }),
  ).toBeVisible();

  const replacement = "Synthetic-Association-New-Password-2026";
  await page
    .getByRole("link", { name: "Cambiar contraseña", exact: true })
    .click();
  await page
    .getByLabel("Contraseña actual", { exact: true })
    .fill(fixture.password);
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(replacement);
  await page
    .getByLabel("Repetir nueva contraseña", { exact: true })
    .fill(replacement);
  await page
    .getByRole("button", { name: "Cambiar contraseña", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Contraseña actualizada" }),
  ).toContainText("Contraseña actualizada");
  await expect(
    page.getByRole("button", { name: "Asociar Google" }),
  ).toBeVisible();
  await signInOAuthFixture(googleContext, id);
  await googlePage.goto("/app");
  await expect(googlePage).toHaveURL("/unauthorized?reason=identity_conflict");

  const explicitRedirect = await startAssociation(context, baseURL!);
  const explicitCode = await completeLinkProviderFixture(explicitRedirect, id);
  await page.goto(`/auth/callback?code=${encodeURIComponent(explicitCode)}`);
  await expect(page).toHaveURL("/app/perfil?status=linked");
  await expect(
    page.getByRole("status").filter({ hasText: "Google está asociado" }),
  ).toContainText("Google está asociado");
  await expect(
    page.getByRole("button", { name: "Asociar Google" }),
  ).toHaveCount(0);
  await googlePage.goto("/app/perfil");
  await expect(
    googlePage.getByRole("heading", { name: "Mi perfil" }),
  ).toBeVisible();
  await googlePage.goto("/app/cursos");
  await expect(googlePage).toHaveURL("/unauthorized?reason=forbidden");
  await googleContext.close();
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .first()
    .click();
  await login(page, { email: fixture.email, password: replacement });
  await expect(
    page.getByRole("button", { name: "Asociar Google" }),
  ).toHaveCount(0);
});

test("switched password sessions and forged link cookies cannot approve Google or silently sign out the owner", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const fixture = AUTH_FIXTURES.associationStale;
  const id = await authId(fixture.email);
  await login(page, fixture);
  const redirect = await startAssociation(context, baseURL!);
  await context.request.post("/auth/password", {
    headers: { origin: new URL(baseURL!).origin },
    form: { email: fixture.email, password: fixture.password },
    maxRedirects: 0,
  });
  await attachGoogleFixture(id, fixture.email);
  const code = await completeLinkProviderFixture(redirect, id);
  await page.goto(`/auth/callback?code=${encodeURIComponent(code)}`);
  await expect(page).toHaveURL("/app/perfil?error=link");
  await expect(
    page.getByRole("button", { name: "Asociar Google" }),
  ).toBeVisible();
  const newRedirect = await startAssociation(context, baseURL!);
  const [cookie] = (await context.cookies()).filter(
    (entry) => entry.name === "auth-link-proof",
  );
  if (!cookie) throw new Error("Link proof fixture is unavailable");
  await context.addCookies([{ ...cookie, value: cookie.value + "a" }]);
  const newCode = await completeLinkProviderFixture(newRedirect, id);
  await page.goto(`/auth/callback?code=${encodeURIComponent(newCode)}`);
  await expect(page).toHaveURL("/app/perfil?error=link");
  await expect(page.getByRole("heading", { name: "Mi perfil" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Asociar Google" }),
  ).toBeVisible();
});

test("Google-only ADMIN creates a password with recent approved OAuth, then recovery uses a bounded session proof", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const fixture = await createGoogleOnlyAdminFixture();
  const id = fixture.authUserId;
  try {
    await signInOAuthFixture(context, id);
    await page.goto("/app/perfil");
    await expect(
      page.getByRole("heading", { name: "Mi perfil" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Asociar Google" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Enviar enlace de confirmación" }),
    ).toHaveCount(0);
    await page
      .getByRole("link", { name: "Crear contraseña", exact: true })
      .click();
    await expect(
      page.getByLabel("Contraseña actual", { exact: true }),
    ).toHaveCount(0);
    const password = "Synthetic-Optional-Google-Password-2026";
    await page.getByLabel("Nueva contraseña", { exact: true }).fill(password);
    await page
      .getByLabel("Repetir nueva contraseña", { exact: true })
      .fill(password);
    await page
      .getByRole("button", { name: "Crear contraseña", exact: true })
      .click();
    await expect(page).toHaveURL("/app/perfil?status=password_changed");
    await expect(
      page.getByRole("link", { name: "Cambiar contraseña", exact: true }),
    ).toBeVisible();
    // A historical Google identity/current OAuth session must not bypass the old
    // password once Auth reports that a credential exists.
    const bypass = await context.request.post("/app/perfil/contrasena", {
      headers: { origin: new URL(baseURL!).origin, accept: "application/json" },
      form: {
        password: "Synthetic-Unauthorized-Change-2026",
        confirmation: "Synthetic-Unauthorized-Change-2026",
      },
    });
    expect(bypass.status()).toBe(422);
    expect((await bypass.json()).fields.currentPassword).toContain(
      "actual es incorrecta",
    );
    const recovery = await prepareBrowserRecoveryFixture(context, id, baseURL!);
    await page.goto(
      `/auth/recovery?code=${encodeURIComponent(recovery.code)}&sb_flow_id=${encodeURIComponent(recovery.flowId)}`,
    );
    await expect(page).toHaveURL("/app/perfil/contrasena?status=confirmed");
    await expect(
      page.getByLabel("Contraseña actual", { exact: true }),
    ).toHaveCount(0);
    const recoveredPassword = "Synthetic-Recovered-Google-Password-2026";
    await page
      .getByLabel("Nueva contraseña", { exact: true })
      .fill(recoveredPassword);
    await page
      .getByLabel("Repetir nueva contraseña", { exact: true })
      .fill(recoveredPassword);
    await page
      .getByRole("button", { name: "Restablecer contraseña", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Contraseña actualizada" }),
    ).toContainText("Contraseña actualizada");
    await page
      .getByRole("button", { name: "Cerrar sesión", exact: true })
      .first()
      .click();
    await login(page, { email: fixture.email, password: recoveredPassword });
    await expect(
      page
        .getByRole("form", { name: "Editar nombre" })
        .getByLabel("Nombre", { exact: true }),
    ).toHaveValue(fixture.name);
    await page.goto("/app/configuracion");
    await expect(page).toHaveURL("/app/configuracion");
  } finally {
    await fixture.cleanup();
  }
});
