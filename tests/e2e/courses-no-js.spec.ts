import { expect, test } from "@playwright/test";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test.use({ javaScriptEnabled: false });

test("server-rendered format creation and revision work without JavaScript", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.mobileMultiRole.email);
  await page.goto("/app/formatos");
  const name = `Formato sin JavaScript ${Date.now()}`;
  const create = page.getByRole("form", { name: "Crear formato" });
  await create.getByLabel("Nombre").fill(name);
  await create.getByLabel("Duración total (horas)").fill("24");
  await create.getByLabel("Precio estudiante (BOB)").fill("invalid");
  await create.getByLabel("Precio externo (BOB)").fill("100");
  await create.getByRole("button", { name: "Crear formato" }).click();
  expect(
    await create
      .getByLabel("Precio estudiante (BOB)")
      .evaluate((input: HTMLInputElement) => input.validity.patternMismatch),
  ).toBe(true);
  await expect(create.getByLabel("Nombre")).toHaveValue(name);
  const invalidServerResponse = await page.request.post("/app/formatos", {
    form: {
      intent: "create",
      name: "Formato rechazado por servidor",
      totalHours: "24",
      studentAmount: "invalid",
      externalAmount: "100",
    },
    headers: { Origin: "http://127.0.0.1:4321" },
  });
  expect(invalidServerResponse.status()).toBe(422);
  expect(await invalidServerResponse.text()).toContain("Revisa los campos");
  await create.getByLabel("Precio estudiante (BOB)").fill("80");
  await create.getByRole("button", { name: "Crear formato" }).click();
  await expect(page).toHaveURL(/success=create/);
  const article = page.getByRole("article").filter({ hasText: name });
  await article.getByText("Editar duración y precios").click();
  await article
    .getByRole("form", { name: `Revisar ${name}` })
    .getByLabel("Horas")
    .fill("30");
  await article.getByRole("button", { name: "Guardar nueva revisión" }).click();
  await expect(page).toHaveURL(/success=revise/);
  await expect(
    page.getByRole("article").filter({ hasText: name }),
  ).toContainText("30 horas");
  await article.getByRole("button", { name: "Desactivar formato" }).click();
  await expect(
    page.getByRole("article").filter({ hasText: name }),
  ).toContainText("Inactivo");
  await article.getByRole("button", { name: "Activar formato" }).click();
  await expect(
    page.getByRole("article").filter({ hasText: name }),
  ).toContainText("Activo");
});
