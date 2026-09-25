import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

async function fillCourseFields(page: Page, formatName: string): Promise<void> {
  await page
    .getByLabel("Descripción")
    .fill("Contenido determinista para validar el flujo administrativo.");
  await page.getByRole("combobox", { name: "Nivel" }).click();
  await expect
    .poll(async () => {
      const box = await page.getByRole("listbox").boundingBox();
      const height = await page.evaluate(() => window.innerHeight);
      return Boolean(box && box.y >= 0 && box.y + box.height <= height);
    })
    .toBe(true);
  await page.getByRole("option", { name: "Medio" }).click();
  await page.getByRole("combobox", { name: "Formato de curso" }).click();
  await page.getByRole("option", { name: new RegExp(formatName) }).click();
  await page.getByRole("checkbox", { name: "Lunes" }).click();
  await page.getByLabel("Desde", { exact: true }).fill("18:30");
  await page.getByLabel("Hasta", { exact: true }).fill("20:30");
  await page.getByLabel("Condiciones").fill("Sujeto a confirmación de cupo.");
  for (const [label, date, time] of [
    ["Inicio del curso", "01/03/2027", "18:30"],
    ["Finalización del curso", "01/04/2027", "20:30"],
    ["Apertura de preinscripción", "01/01/2027", "08:00"],
    ["Cierre de preinscripción", "20/02/2027", "18:00"],
  ] as const) {
    await page.getByLabel(label, { exact: true }).fill(date);
    await page
      .getByRole("textbox", {
        name: `Hora de ${label.toLowerCase()}`,
        exact: true,
      })
      .fill(time);
  }
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

test("admin crops a photo in the new-course form and can retry a failed upload without creating another draft", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const formatName = `Formato foto ${Date.now()}`;
  await page.goto("/app/formatos");
  await page.getByRole("link", { name: "Nuevo formato" }).click();
  const format = page.getByRole("form", { name: "Crear formato" });
  await format.getByLabel("Nombre").fill(formatName);
  await format.getByLabel("Duración total (horas)").fill("20");
  await format.getByLabel("Precio estudiante (BOB)").fill("80");
  await format.getByLabel("Precio externo (BOB)").fill("100");
  await format.getByRole("button", { name: "Crear formato" }).click();
  await page.goto("/app/cursos/nuevo");
  await page.getByLabel("Nombre").fill(`Curso con foto ${Date.now()}`);
  await fillCourseFields(page, formatName);
  const bytes = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(400, 250);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#946b51";
    ctx.fillRect(0, 0, 400, 250);
    return Array.from(
      new Uint8Array(
        await (
          await canvas.convertToBlob({ type: "image/webp" })
        ).arrayBuffer(),
      ),
    );
  });
  await page.getByLabel("Seleccionar foto del curso").setInputFiles({
    name: "fixture.webp",
    mimeType: "image/webp",
    buffer: Buffer.from(bytes),
  });
  await expect(
    page.getByRole("img", { name: "Vista previa del encuadre del curso" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Confirma el recorte" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Usar este recorte" }).click();
  await expect(page.getByText("Foto lista para cargarse")).toBeVisible();
  await page
    .getByLabel("Finalización del curso", { exact: true })
    .fill("01/02/2027");
  const create = page.getByRole("button", { name: "Crear borrador" });
  await expect(create).toBeDisabled();
  const invalidForm = await page
    .locator("form.course-form")
    .evaluate((form) =>
      Object.fromEntries(new FormData(form as HTMLFormElement).entries()),
    );
  const invalidResponse = await page.request.post("/app/cursos/nuevo", {
    form: invalidForm,
    headers: {
      Accept: "application/json",
      Origin: new URL(page.url()).origin,
    },
  });
  expect(invalidResponse.status()).toBe(422);
  const invalidBody = await invalidResponse.json();
  expect(invalidBody.fieldErrors).toHaveProperty("endsAt");
  await expect(page.getByLabel("Nombre")).toHaveValue(/Curso con foto/);
  await expect(page.getByText("Foto lista para cargarse")).toBeVisible();
  await page
    .getByLabel("Finalización del curso", { exact: true })
    .fill("01/04/2027");
  let failed = false;
  await page.route("**/app/cursos/imagen", async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Fallo temporal de carga." }),
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Fallo temporal de carga." }),
  ).toBeVisible();
  const draftUrl = await page
    .getByRole("link", { name: "Abrir borrador" })
    .getAttribute("href");
  expect(draftUrl).toMatch(/\/app\/cursos\/[0-9a-f-]+\/editar/);
  await page.getByRole("button", { name: "Reintentar foto" }).click();
  await expect(page).toHaveURL(/\/editar\?success=updated$/);
  expect(page.url()).toContain(draftUrl!);
  const key = await page.locator('input[name="artwork"]').inputValue();
  expect(key).toMatch(/^courses\/[0-9a-f-]+\/[0-9a-f-]+\.webp$/);
  await page.reload();
  await expect(page.locator('input[name="artwork"]')).toHaveValue(key);
  const env = getTestSupabaseEnvironment();
  const storage = createClient(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
  const object = await storage.from("course-artwork").info(key);
  expect(object.error).toBeNull();
  await storage.from("course-artwork").remove([key]);
});

test("admin creates, validates, edits, publishes, withdraws and archives a course", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const formatName = `Formato E2E ${Date.now()}`;
  await page.goto("/app/formatos");
  await page.getByRole("link", { name: "Nuevo formato" }).click();
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
  await expect(page).toHaveURL(/\/app\/formatos$/);
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Formato creado",
  );
  await page.goto("/app/cursos/nuevo");
  const create = page.getByRole("button", { name: "Crear borrador" });
  await expect(create).toBeDisabled();
  await page.getByLabel("Nombre").fill("Curso E2E conservación");
  await expect(create).toBeDisabled();
  await expect(page).toHaveURL(/\/app\/cursos\/nuevo$/);
  await expect(page.getByLabel("Nombre")).toHaveValue("Curso E2E conservación");

  await fillCourseFields(page, formatName);
  await expect(create).toBeEnabled();
  await page.getByLabel("Instructor (opcional)").fill("Docente temporal");
  await expect(create).toBeEnabled();
  await page.getByLabel("Instructor (opcional)").clear();
  await page.getByLabel("Condiciones").clear();
  await expect(create).toBeDisabled();
  await page.getByLabel("Condiciones").fill("Sujeto a confirmación de cupo.");
  await expect(create).toBeEnabled();
  const grade = page.getByLabel("Nota mínima (0–100)");
  await grade.focus();
  await page.keyboard.press("End");
  await page.keyboard.type("e");
  await expect(grade).toHaveValue("70");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("9x"));
  await grade.press("ControlOrMeta+A");
  await grade.press("ControlOrMeta+V");
  await expect(grade).toHaveValue("70");
  const startDate = page.getByLabel("Inicio del curso", { exact: true });
  await startDate.focus();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await expect(startDate).toHaveValue("01/03/2027");
  await page.evaluate(() => navigator.clipboard.writeText("bad/date"));
  await startDate.press("ControlOrMeta+A");
  await startDate.press("ControlOrMeta+V");
  await expect(startDate).toHaveValue("01/03/2027");
  const startTime = page.getByRole("textbox", {
    name: "Hora de inicio del curso",
  });
  await startTime.focus();
  await page.keyboard.press("End");
  await page.keyboard.type("q");
  await expect(startTime).toHaveValue("18:30");
  await page.evaluate(() => navigator.clipboard.writeText("29:99"));
  await startTime.press("ControlOrMeta+A");
  await startTime.press("ControlOrMeta+V");
  await expect(startTime).toHaveValue("18:30");
  await startDate.fill("30/02/2027");
  await expect(create).toBeDisabled();
  await expect(startDate).toHaveValue("30/02/2027");
  await expect(
    page.getByText("Ingresa una fecha válida (DD/MM/AAAA).", { exact: true }),
  ).toBeVisible();
  await startDate.fill("01/03/2027");
  await expect(create).toBeEnabled();
  const calendarTrigger = page.locator("#startsAt-calendar");
  await calendarTrigger.click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendarTrigger).toBeFocused();
  await page.getByLabel("Instructor (opcional)").fill("Docente E2E");
  await page.getByRole("checkbox", { name: "Miércoles" }).click();
  await expect(page.locator('input[name="schedule"]')).toHaveValue(
    "Lunes y Miércoles, 18:30–20:30",
  );
  await page
    .getByLabel("Contenido del curso (Markdown, opcional)")
    .fill("## Temario\n- Unidad uno");
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await expect(page).toHaveURL(
    /\/app\/cursos\/[^/]+\/editar\?success=created$/,
  );
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Borrador creado",
  );
  const save = page.getByRole("button", { name: "Guardar cambios" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Nombre").fill("Curso temporalmente inválido");
  await page.getByLabel("Nombre").clear();
  await expect(save).toBeDisabled();
  await page.getByLabel("Nombre").fill("Curso E2E conservación");
  await expect(save).toBeDisabled();
  const gradeInput = page.getByLabel("Nota mínima (0–100)");
  await page.getByLabel("Nombre").fill("Curso temporalmente inválido");
  await gradeInput.evaluate((input) => {
    (input as HTMLInputElement).value = "101";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(save).toBeDisabled();
  await gradeInput.evaluate((input) => {
    (input as HTMLInputElement).value = "70";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const courseStart = page.locator('input[name="startsAt"]');
  await courseStart.evaluate((input) => {
    (input as HTMLInputElement).value = "2027-02-30T18:30";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(save).toBeDisabled();
  await courseStart.evaluate((input) => {
    (input as HTMLInputElement).value = "2027-03-01T18:30";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(save).toBeEnabled();
  await page.getByLabel("Nombre").fill("Curso E2E conservación");
  await expect(save).toBeDisabled();
  await page.locator('input[name="artwork"]').evaluate((input) => {
    (input as HTMLInputElement).value = "artwork/temporary.webp";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(save).toBeEnabled();
  await page.locator('input[name="artwork"]').evaluate((input) => {
    (input as HTMLInputElement).value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(save).toBeDisabled();
  await page.getByLabel("Descripción").fill("Texto conservado tras rechazo.");
  await page.locator('input[name="revision"]').evaluate((input) => {
    (input as HTMLInputElement).value = "invalid-revision";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(save).toBeEnabled();
  const failedUpdate = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/app/cursos/") &&
      response.url().includes("/editar"),
  );
  await save.click();
  expect((await failedUpdate).status()).toBe(422);
  await expect(page.getByLabel("Descripción")).toHaveValue(
    "Texto conservado tras rechazo.",
  );
  await expect(page.getByRole("alert").first()).toContainText(
    "La revisión del curso no es válida.",
  );
  await page
    .getByLabel("Descripción")
    .fill("Contenido determinista para validar el flujo administrativo.");
  await page.getByLabel("Nombre").fill("Curso E2E editado");
  await expect(save).toBeEnabled();
  await page.getByLabel("Nombre").fill("Curso E2E conservación");
  await expect(save).toBeDisabled();
  await page.getByRole("combobox", { name: "Nivel" }).click();
  await page.getByRole("option", { name: "Básico" }).click();
  await expect(save).toBeEnabled();
  await page.getByRole("combobox", { name: "Nivel" }).click();
  await page.getByRole("option", { name: "Medio" }).click();
  await expect(save).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Hora de inicio del curso", exact: true })
    .fill("19:30");
  await expect(save).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Hora de inicio del curso", exact: true })
    .fill("18:30");
  await expect(save).toBeDisabled();
  await page
    .getByLabel("Finalización del curso", { exact: true })
    .fill("02/04/2027");
  await expect(save).toBeEnabled();
  await page
    .getByLabel("Finalización del curso", { exact: true })
    .fill("01/04/2027");
  await expect(save).toBeDisabled();
  await page.getByRole("checkbox", { name: "Viernes" }).click();
  await expect(save).toBeEnabled();
  await page.getByRole("checkbox", { name: "Viernes" }).click();
  await expect(save).toBeDisabled();
  const markdown = page.getByLabel("Contenido del curso (Markdown, opcional)");
  await markdown.fill("## Temario\n- Unidad uno\nNota");
  await expect(save).toBeEnabled();
  await markdown.fill("## Temario\n- Unidad uno");
  await expect(save).toBeDisabled();
  await markdown.selectText();
  await page.getByRole("button", { name: "Negrita" }).click();
  await expect(save).toBeEnabled();
  await markdown.fill("## Temario\n- Unidad uno");
  await expect(save).toBeDisabled();
  await expect(
    page.getByLabel("Inicio del curso", { exact: true }),
  ).toHaveValue("01/03/2027");
  await expect(page.locator('input[name="startsAt"]')).toHaveValue(
    "2027-03-01T18:30",
  );
  await expect(
    page.getByLabel("Apertura de preinscripción", { exact: true }),
  ).toHaveValue("01/01/2027");
  await expect(page.getByLabel("Instructor (opcional)")).toHaveValue(
    "Docente E2E",
  );
  await expect(page.locator('input[name="schedule"]')).toHaveValue(
    "Lunes y Miércoles, 18:30–20:30",
  );
  await page.locator('input[name="artwork"]').evaluate((input) => {
    (input as HTMLInputElement).value = "https://example.test/forged.webp";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(save).toBeEnabled();
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
  // The failed POST must compare attempted fields against the persisted course,
  // not treat the invalid submitted values as the new clean snapshot.
  await expect(save).toBeEnabled();
  await page.locator('input[name="artwork"]').evaluate((input) => {
    (input as HTMLInputElement).value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Escribir horario libre" }).click();
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
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Cambios guardados",
  );
  await expect(save).toBeDisabled();
  await page.getByText("Publicar curso", { exact: true }).click();
  await expectPostRedirect(page, () =>
    page.getByRole("button", { name: "Confirmar publicación" }).click(),
  );
  await expect(page).toHaveURL(/\?success=published$/);
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Curso publicado",
  );
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
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "devuelto a borrador",
  );
  await page.getByText("Archivar curso", { exact: true }).click();
  await expectPostRedirect(page, () =>
    page.getByRole("button", { name: "Confirmar archivo" }).click(),
  );
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Curso archivado",
  );
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
  await page.goto("/app/cursos/nuevo");
  await expect(
    page.getByRole("toolbar", { name: "Formato Markdown" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
