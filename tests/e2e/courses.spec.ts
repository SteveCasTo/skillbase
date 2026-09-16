import { expect, test, type Page } from "@playwright/test";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

async function fillCourseFields(page: Page): Promise<void> {
  await page
    .getByLabel("Descripción")
    .fill("Contenido determinista para validar el flujo administrativo.");
  await page.getByLabel("Nivel").selectOption("INTERMEDIATE");
  await page.getByLabel("Duración total (horas)").fill("20");
  await page
    .getByLabel("Horario informativo")
    .fill("Lunes y miércoles, 18:30–20:30");
  await page.getByLabel("Condiciones").fill("Sujeto a confirmación de cupo.");
  await page.getByLabel("Inicio del curso").fill("2027-03-01T18:30");
  await page.getByLabel("Finalización del curso").fill("2027-04-01T20:30");
  await page.getByLabel("Apertura de preinscripción").fill("2027-01-01T08:00");
  await page.getByLabel("Cierre de preinscripción").fill("2027-02-20T18:00");
  await page.getByLabel("Precio estudiante (BOB)").fill("80");
  await page.getByLabel("Precio externo (BOB)").fill("100.50");
  await page.getByLabel("Nota mínima (0–100)").fill("70");
}

async function expectPostRedirect(page: Page, action: () => Promise<void>) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/app/cursos/"),
  );
  await action();
  expect((await responsePromise).status()).toBe(303);
}

test("admin creates, validates, edits, publishes, withdraws and archives a course", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/cursos/nuevo");
  await page.getByLabel("Nombre").fill("Curso E2E conservación");
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await expect(page.getByRole("alert")).toContainText("Revisa los campos");
  await expect(page.getByLabel("Nombre")).toHaveValue("Curso E2E conservación");

  await fillCourseFields(page);
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await expect(page).toHaveURL(/\/app\/cursos\?success=created$/);
  const card = page
    .getByRole("article")
    .filter({ hasText: "Curso E2E conservación" });
  await expect(card).toContainText("Borrador");
  await card.getByRole("link", { name: "Revisar y editar" }).click();
  await expect(page.getByLabel("Inicio del curso")).toHaveValue(
    "2027-03-01T18:30",
  );
  await expect(page.getByLabel("Apertura de preinscripción")).toHaveValue(
    "2027-01-01T08:00",
  );

  await page
    .getByLabel("Descripción")
    .fill("Contenido actualizado antes de publicar.");
  await expectPostRedirect(page, () =>
    page.getByRole("button", { name: "Guardar cambios" }).click(),
  );
  await expect(page).toHaveURL(/\?success=updated$/);
  await expect(page.getByRole("status")).toContainText("Cambios guardados");
  await page.getByText("Publicar curso", { exact: true }).click();
  await expectPostRedirect(page, () =>
    page.getByRole("button", { name: "Confirmar publicación" }).click(),
  );
  await expect(page).toHaveURL(/\?success=published$/);
  await expect(page.getByRole("status")).toContainText("Curso publicado");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Curso publicado");

  await page.getByLabel("Precio estudiante (BOB)").fill("85.25");
  await expectPostRedirect(page, () =>
    page.getByRole("button", { name: "Guardar cambios" }).click(),
  );
  await expect(page.getByLabel("Precio estudiante (BOB)")).toHaveValue("85.25");
  await page.getByText("Retirar publicación", { exact: true }).click();
  await expectPostRedirect(page, () =>
    page.getByRole("button", { name: "Confirmar retiro" }).click(),
  );
  await expect(page.getByRole("status")).toContainText("devuelto a borrador");
  await page.getByText("Archivar curso", { exact: true }).click();
  await expectPostRedirect(page, () =>
    page.getByRole("button", { name: "Confirmar archivo" }).click(),
  );
  await expect(page.getByRole("status")).toContainText("Curso archivado");
  await expect(page.getByLabel("Nombre")).toBeDisabled();
});

test("instructor is denied and mutation without expected origin is rejected", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto("/app/cursos/nuevo");
  await expect(page).toHaveURL(/\/unauthorized\?reason=forbidden$/);

  await context.clearCookies();
  await signInFixture(context, AUTH_FIXTURES.originAdmin.email);
  const response = await page.request.post("/app/cursos/nuevo", {
    form: { name: "Blocked origin" },
  });
  expect(response.status()).toBe(403);
});

test("course administration remains keyboard reachable and responsive", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.multiRole.email);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/cursos");
  await expect(
    page.getByRole("heading", { name: "Cursos", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  await expect(page.getByRole("link", { name: "Nuevo curso" })).toBeVisible();
});
