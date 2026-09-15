import { expect, test } from "@playwright/test";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test("redirects unauthenticated private requests to login safely", async ({
  page,
}) => {
  const response = await page.goto("/app/cursos?tab=active");
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  await expect(page).toHaveURL(
    /\/login\?next=%2Fapp%2Fcursos%3Ftab%3Dactive$/u,
  );
  await expect(
    page.getByRole("button", { name: "Continuar con Google" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("admin accesses administration but direct instructor URL is denied", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const response = await page.goto("/app/cursos");
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  await expect(
    page.getByRole("heading", { level: 1, name: "Cursos" }),
  ).toBeVisible();
  await page.goto("/app/asistencia");
  await expect(page).toHaveURL(/\/unauthorized\?reason=forbidden$/u);
  await expect(
    page.getByRole("heading", { name: "Permiso insuficiente" }),
  ).toBeVisible();
});

test("instructor accesses attendance and is denied the admin URL", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto("/app/asistencia");
  await expect(
    page.getByRole("heading", { level: 1, name: "Asistencia" }),
  ).toBeVisible();
  await page.goto("/app/cursos");
  await expect(page).toHaveURL(/\/unauthorized\?reason=forbidden$/u);
});

test("multi-role user sees and accesses both sections", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.multiRole.email);
  await page.goto("/app");
  const navigation = page.getByRole("navigation", {
    name: "Navegación privada",
  });
  await expect(navigation.getByRole("link", { name: "Cursos" })).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Asistencia" }),
  ).toBeVisible();
  await page.goto("/app/cursos");
  await expect(
    page.getByRole("heading", { level: 1, name: "Cursos" }),
  ).toBeVisible();
  await page.goto("/app/asistencia");
  await expect(
    page.getByRole("heading", { level: 1, name: "Asistencia" }),
  ).toBeVisible();
});

test("disabled, unknown and active no-role identities receive exact denials", async ({
  browser,
}) => {
  for (const [email, reason] of [
    [AUTH_FIXTURES.disabled.email, "disabled"],
    [AUTH_FIXTURES.unknown.email, "not_invited"],
    [AUTH_FIXTURES.noRole.email, "no_roles"],
  ] as const) {
    const context = await browser.newContext();
    await signInFixture(context, email);
    const page = await context.newPage();
    const response = await page.goto("/app");
    await expect(page).toHaveURL(`/unauthorized?reason=${reason}`);
    expect(response?.headers()["cache-control"]).toBe("private, no-store");
    await expect(
      page.getByRole("heading", { name: "Acceso no habilitado" }),
    ).toBeVisible();
    await context.close();
  }
});

test("unknown future private routes fail closed", async ({ context, page }) => {
  await signInFixture(context, AUTH_FIXTURES.futureRoute.email);
  await page.goto("/app/future-route");
  await expect(page).toHaveURL("/unauthorized?reason=forbidden");
});

test("cross-origin auth actions are rejected without clearing the session", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.originAdmin.email);
  const logout = await context.request.post("/auth/logout", {
    headers: {
      Origin: "https://untrusted.example",
      "Content-Type": "text/plain",
    },
    data: "",
    failOnStatusCode: false,
  });
  expect(logout.status()).toBe(403);
  const oauth = await context.request.post("/auth/google", {
    headers: {
      Origin: "https://untrusted.example",
      "Content-Type": "text/plain",
    },
    data: "",
    failOnStatusCode: false,
  });
  expect(oauth.status()).toBe(403);
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: /Hola, Omar Origin/u }),
  ).toBeVisible();
});

test("logout revokes only the current browser session", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  await signInFixture(firstContext, AUTH_FIXTURES.logoutAdmin.email);
  await signInFixture(secondContext, AUTH_FIXTURES.logoutAdmin.email);
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  await firstPage.goto("/app");
  await firstPage.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(firstPage).toHaveURL(/\/login\?status=signed_out$/u);
  await firstPage.goto("/app");
  await expect(firstPage).toHaveURL(/\/login\?next=/u);
  await secondPage.goto("/app");
  await expect(
    secondPage.getByRole("heading", { name: /Hola, Lara Logout/u }),
  ).toBeVisible();
  await firstContext.close();
  await secondContext.close();
});
