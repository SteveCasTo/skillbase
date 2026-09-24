import { expect, test, type Page } from "@playwright/test";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

async function fillCourseFields(page: Page, formatName: string): Promise<void> {
  await page
    .getByLabel("Descripción")
    .fill("Contenido determinista para validar el flujo administrativo.");
  await page.getByRole("combobox", { name: "Nivel" }).click();
  await page.getByRole("option", { name: "Medio" }).click();
  await page.getByRole("combobox", { name: "Formato de curso" }).click();
  await page.getByRole("option", { name: new RegExp(formatName) }).click();
  await page
    .getByLabel("Horario informativo")
    .fill("Lunes y miércoles, 18:30–20:30");
  await page.getByLabel("Condiciones").fill("Sujeto a confirmación de cupo.");
  await page.getByLabel("Inicio del curso").fill("2027-03-01T18:30");
  await page.getByLabel("Finalización del curso").fill("2027-04-01T20:30");
  await page.getByLabel("Apertura de preinscripción").fill("2027-01-01T08:00");
  await page.getByLabel("Cierre de preinscripción").fill("2027-02-20T18:00");
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
  test.setTimeout(90_000);
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const formatName = `Formato E2E ${Date.now()}`;
  await page.goto("/app/formatos");
  await page
    .getByRole("form", { name: "Crear formato" })
    .getByLabel("Nombre")
    .fill(formatName);
  await page
    .getByRole("form", { name: "Crear formato" })
    .getByLabel("Duración total (horas)")
    .fill("20");
  await page
    .getByRole("form", { name: "Crear formato" })
    .getByLabel("Precio estudiante (BOB)")
    .fill("80");
  await page
    .getByRole("form", { name: "Crear formato" })
    .getByLabel("Precio externo (BOB)")
    .fill("100.50");
  await page.getByRole("button", { name: "Crear formato" }).click();
  await expect(page).toHaveURL(/success=create/);
  await page.goto("/app/cursos/nuevo");
  await page.getByLabel("Nombre").fill("Curso E2E conservación");
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await expect(page).toHaveURL(/\/app\/cursos\/nuevo$/);
  await expect(page.getByLabel("Nombre")).toHaveValue("Curso E2E conservación");

  await fillCourseFields(page, formatName);
  const startDate = page.getByLabel("Inicio del curso");
  await startDate.fill("2027-02-30T18:30");
  await expect(startDate).toHaveValue("2027-02-30T18:30");
  await expect(
    page.getByText("Ingresa una fecha y hora válidas.", { exact: true }),
  ).toBeVisible();
  await startDate.fill("2027-03-01T18:30");
  const calendarTrigger = page.locator("#startsAt-calendar");
  await calendarTrigger.click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendarTrigger).toBeFocused();
  await page.getByLabel("Instructor (opcional)").fill("Docente E2E");
  await page.getByRole("checkbox", { name: "Lunes" }).check();
  await page.getByRole("checkbox", { name: "Miércoles" }).check();
  await page.getByRole("textbox", { name: "Desde (HH:MM)" }).fill("18:30");
  await page.getByRole("textbox", { name: "Hasta (HH:MM)" }).fill("20:30");
  await page.getByRole("button", { name: "Usar este horario" }).click();
  await expect(page.getByLabel("Horario informativo")).toHaveValue(
    "Lunes y Miércoles, 18:30–20:30",
  );
  await page
    .getByLabel("Contenido del curso (Markdown, opcional)")
    .fill("## Temario\n- Unidad uno");
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
  await expect(page.getByLabel("Instructor (opcional)")).toHaveValue(
    "Docente E2E",
  );
  await expect(page.getByLabel("Horario informativo")).toHaveValue(
    "Lunes y Miércoles, 18:30–20:30",
  );
  await page.locator('input[name="artwork"]').evaluate((input) => {
    (input as HTMLInputElement).value = "https://example.test/forged.webp";
  });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("alert").first()).toContainText(
    "imagen seleccionada",
  );
  await expect(page.getByLabel("Nombre")).toHaveValue("Curso E2E conservación");
  await expect(page.getByRole("combobox", { name: "Nivel" })).toContainText(
    "Medio",
  );
  await expect(
    page.getByRole("combobox", { name: "Formato de curso" }),
  ).toContainText(formatName);
  await expect(page.locator('input[name="artwork"]')).toHaveValue(
    "https://example.test/forged.webp",
  );
  await page.locator('input[name="artwork"]').evaluate((input) => {
    (input as HTMLInputElement).value = "";
  });
  await page
    .getByLabel("Horario informativo")
    .fill("Horario especial acordado con el grupo");

  await page
    .getByLabel("Descripción")
    .fill("Contenido actualizado antes de publicar.");
  await expectPostRedirect(page, () =>
    page.getByRole("button", { name: "Guardar cambios" }).click(),
  );
  await expect(page).toHaveURL(/\?success=updated$/);
  await expect(page.getByLabel("Horario informativo")).toHaveValue(
    "Horario especial acordado con el grupo",
  );
  await expect(page.getByRole("status")).toContainText("Cambios guardados");
  await page.getByText("Publicar curso", { exact: true }).click();
  await expectPostRedirect(page, () =>
    page.getByRole("button", { name: "Confirmar publicación" }).click(),
  );
  await expect(page).toHaveURL(/\?success=published$/);
  await expect(page.getByRole("status")).toContainText("Curso publicado");
  await expectPostRedirect(page, () =>
    page.getByRole("button", { name: "Destacar en la cartelera" }).click(),
  );
  await expect(page.getByText("Destacado en la cartelera")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Destacado en la cartelera")).toBeVisible();

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
  await page.goto("/app/formatos");
  await expect(page).toHaveURL(/\/unauthorized\?reason=forbidden$/);
  const uploadResponse = await page.request.post("/app/cursos/imagen", {
    multipart: {
      courseId: "10000000-0000-4000-8000-000000000001",
      image: {
        name: "malformada.webp",
        mimeType: "image/webp",
        buffer: Buffer.from("not an image"),
      },
    },
    headers: { Origin: "http://127.0.0.1:4321" },
    maxRedirects: 0,
  });
  expect(uploadResponse.status()).toBe(303);
  expect(uploadResponse.headers().location).toContain(
    "/unauthorized?reason=forbidden",
  );

  await context.clearCookies();
  await signInFixture(context, AUTH_FIXTURES.originAdmin.email);
  const response = await page.request.post("/app/cursos/nuevo", {
    form: { name: "Blocked origin" },
  });
  expect(response.status()).toBe(403);
  const formatResponse = await page.request.post("/app/formatos", {
    form: { intent: "create", name: "Blocked" },
  });
  expect(formatResponse.status()).toBe(403);
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
