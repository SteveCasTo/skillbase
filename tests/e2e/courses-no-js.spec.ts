import { expect, test } from "@playwright/test";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test.use({ javaScriptEnabled: false });

test("server-rendered course update works without JavaScript", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.mobileMultiRole.email);
  await page.goto("/app/cursos/nuevo");
  await page.getByLabel("Nombre").fill("Curso E2E sin JavaScript");
  await page
    .getByLabel("Descripción")
    .fill("Contenido inicial sin JavaScript.");
  await page.getByLabel("Nivel").selectOption("BASIC");
  await page.getByLabel("Duración total (horas)").fill("20");
  await page.getByLabel("Horario informativo").fill("Viernes, 18:30–20:30");
  await page.getByLabel("Condiciones").fill("Fixture sin JavaScript.");
  await page.getByLabel("Inicio del curso").fill("2027-05-01T18:30");
  await page.getByLabel("Finalización del curso").fill("2027-06-01T20:30");
  await page.getByLabel("Precio estudiante (BOB)").fill("80");
  await page.getByLabel("Precio externo (BOB)").fill("100");
  await page.getByLabel("Nota mínima (0–100)").fill("70");
  await page.getByRole("button", { name: "Crear borrador" }).press("Enter");
  const card = page
    .getByRole("article")
    .filter({ hasText: "Curso E2E sin JavaScript" });
  await card.getByRole("link", { name: "Revisar y editar" }).click();
  await page
    .getByLabel("Descripción")
    .fill("Actualización enviada sin JavaScript.");
  await page.getByRole("button", { name: "Guardar cambios" }).press("Enter");
  await expect(page).toHaveURL(/\?success=updated$/);
  await expect(page.getByLabel("Descripción")).toHaveValue(
    "Actualización enviada sin JavaScript.",
  );
});
