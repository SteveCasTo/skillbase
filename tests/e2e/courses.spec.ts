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
  await page.getByLabel("Condiciones").fill("Sujeto a confirmación de cupo.");
  for (const [label, date, time] of [
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
  await page
    .getByLabel("Fecha de inicio de clases (Bolivia)")
    .fill("2027-03-01");
  await expect(
    page.getByText("17/03/2027", { exact: false }).first(),
  ).toBeVisible();
  await page.getByLabel("Nota mínima (0–100)").fill("70");
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
  await format.getByLabel("Duración de sesión (minutos)").fill("90");
  await format.getByLabel("Precio estudiante (BOB)").fill("80");
  await format.getByLabel("Precio externo (BOB)").fill("100");
  await page.evaluate(() => {
    (window as Window & { navigationMarker?: boolean }).navigationMarker = true;
  });
  await format.getByRole("button", { name: "Crear formato" }).click();
  await expect(page).toHaveURL(/\/app\/formatos$/);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
  await page.goto("/app/cursos/nuevo");
  await page.getByLabel("Nombre").fill(`Curso con foto ${Date.now()}`);
  await fillCourseFields(page, formatName);
  const groups = page.locator("[data-initial-groups]");
  await groups.getByRole("button", { name: "Añadir grupo" }).click();
  await groups.getByRole("button", { name: "Añadir grupo" }).click();
  const initialGroups = groups.locator("[data-initial-group]");
  await expect(initialGroups).toHaveCount(2);
  await initialGroups.nth(0).locator('[name="initialGroupTime"]').fill("16:00");
  await initialGroups
    .nth(0)
    .locator('[name="initialGroupCapacity"]')
    .fill("20");
  await initialGroups.nth(1).locator('[name="initialGroupTime"]').fill("18:00");
  await initialGroups
    .nth(1)
    .locator('[name="initialGroupCapacity"]')
    .fill("20");
  await expect(
    page.getByText(
      /13 sesiones de 90 min · 19\.5 h planificadas frente a 20 h configuradas/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText("17/03/2027", { exact: false }).first(),
  ).toBeVisible();
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
  const cropDialog = page.getByRole("dialog", {
    name: "Recortar foto del curso",
  });
  await expect(cropDialog).toBeVisible();
  const cropFrame = cropDialog.locator("[data-crop-frame]");
  const cropFrameBox = await cropFrame.boundingBox();
  expect(cropFrameBox).not.toBeNull();
  expect(cropFrameBox!.width / cropFrameBox!.height).toBeCloseTo(8 / 5, 1);
  const cropImage = cropDialog.locator("img[alt='']");
  const initialImageBox = await cropImage.boundingBox();
  expect(initialImageBox).not.toBeNull();
  const zoom = cropDialog.getByRole("slider", { name: "Zoom" });
  await zoom.fill("1.5");
  await expect
    .poll(async () => (await cropImage.boundingBox())?.width)
    .toBeGreaterThan(initialImageBox!.width);
  const beforeDrag = await cropImage.boundingBox();
  expect(beforeDrag).not.toBeNull();
  await cropFrame.dragTo(cropFrame, {
    sourcePosition: { x: cropFrameBox!.width / 2, y: cropFrameBox!.height / 2 },
    targetPosition: {
      x: cropFrameBox!.width / 2 + 18,
      y: cropFrameBox!.height / 2,
    },
  });
  await expect
    .poll(async () => (await cropImage.boundingBox())?.x)
    .not.toBe(beforeDrag!.x);
  await cropDialog.getByRole("button", { name: "Guardar recorte" }).click();
  await expect(cropDialog).toBeHidden();
  await expect(
    page.getByRole("img", { name: "Vista previa del recorte del curso" }),
  ).toBeVisible();
  await page.getByLabel("Seleccionar foto del curso").setInputFiles({
    name: "replacement.webp",
    mimeType: "image/webp",
    buffer: Buffer.from(bytes),
  });
  await expect(cropDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cropDialog).toBeHidden();
  await expect(
    page.getByRole("img", { name: "Vista previa del recorte del curso" }),
  ).toBeVisible();
  await page
    .getByLabel("Fecha de inicio de clases (Bolivia)")
    .fill("2027-03-06");
  const create = page.getByRole("button", { name: "Crear borrador" });
  await expect(create).toBeDisabled();
  const invalidForm = await page
    .locator("form.course-form")
    .evaluate((form) =>
      Object.fromEntries(new FormData(form as HTMLFormElement).entries()),
    );
  invalidForm.endsAt = "2027-03-17T20:00";
  const invalidResponse = await page.request.post("/app/cursos/nuevo", {
    form: invalidForm,
    headers: {
      Accept: "application/json",
      Origin: new URL(page.url()).origin,
    },
  });
  expect(invalidResponse.status()).toBe(422);
  const invalidBody = await invalidResponse.json();
  expect(invalidBody.fieldErrors).toHaveProperty("startsAt");
  await expect(page.getByLabel("Nombre")).toHaveValue(/Curso con foto/);
  await expect(
    page.getByRole("img", { name: "Vista previa del recorte del curso" }),
  ).toBeVisible();
  await page
    .getByLabel("Fecha de inicio de clases (Bolivia)")
    .fill("2027-03-01");
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
  await page.getByRole("button", { name: "Reintentar pendientes" }).click();
  await expect(page).toHaveURL(/\/grupos(?:\?success=created)?$/);
  await expect(page.locator("[data-group-id]")).toHaveCount(2);
  await page.goto(draftUrl!);
  const artwork = page.locator('input[name="artwork"]');
  const key = await artwork.inputValue();
  expect(key).toMatch(/^courses\/[0-9a-f-]+\/[0-9a-f-]+\.webp$/);
  await expect(
    page.getByRole("img", { name: "Foto actual del curso" }),
  ).toBeVisible();
  let uploads = 0;
  await page.route("**/app/cursos/imagen", async (route) => {
    uploads++;
    await route.continue();
  });
  await page.getByLabel("Seleccionar foto del curso").setInputFiles({
    name: "edited.webp",
    mimeType: "image/webp",
    buffer: Buffer.from(bytes),
  });
  await cropDialog.getByRole("button", { name: "Guardar recorte" }).click();
  await expect(
    page.getByRole("button", { name: "Guardar cambios" }),
  ).toBeEnabled();
  expect(uploads).toBe(0);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect.poll(() => uploads).toBe(1);
  await expect(page.locator('input[name="artwork"]')).not.toHaveValue(key);
  await expect(
    page.getByRole("button", { name: "Reemplazar imagen" }),
  ).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Elegir otra imagen del curso" })
    .click();
  expect((await chooser).isMultiple()).toBe(false);
  const editorBox = await page
    .locator("[data-course-image-editor]")
    .boundingBox();
  const nameBox = await page.getByLabel("Nombre").boundingBox();
  expect(editorBox).not.toBeNull();
  expect(nameBox).not.toBeNull();
  expect(editorBox!.x).toBeLessThan(nameBox!.x);
  await page.reload();
  const finalKey = await page.locator('input[name="artwork"]').inputValue();
  expect(finalKey).toMatch(/^courses\/.*\.webp$/);
  await expect(
    page.getByRole("img", { name: "Foto actual del curso" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reemplazar imagen" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileEditorBox = await page
    .locator("[data-course-image-editor]")
    .boundingBox();
  const mobileNameBox = await page.getByLabel("Nombre").boundingBox();
  expect(mobileEditorBox).not.toBeNull();
  expect(mobileNameBox).not.toBeNull();
  expect(mobileEditorBox!.y).toBeLessThan(mobileNameBox!.y);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const env = getTestSupabaseEnvironment();
  const storage = createClient(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
  const object = await storage.from("course-artwork").info(finalKey);
  expect(object.error).toBeNull();
  await storage.from("course-artwork").remove([key, finalKey]);
});

test("retries a persisted initial group after its POST response is lost and creates the remaining groups", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const formatName = `Formato retry grupo ${Date.now()}`;
  await page.goto("/app/formatos");
  await page.getByRole("link", { name: "Nuevo formato" }).click();
  const format = page.getByRole("form", { name: "Crear formato" });
  await format.getByLabel("Nombre").fill(formatName);
  await format.getByLabel("Duración total (horas)").fill("20");
  await format.getByLabel("Duración de sesión (minutos)").fill("90");
  await format.getByLabel("Precio estudiante (BOB)").fill("80");
  await format.getByLabel("Precio externo (BOB)").fill("100");
  await format.getByRole("button", { name: "Crear formato" }).click();
  await page.goto("/app/cursos/nuevo");
  await page.getByLabel("Nombre").fill(`Curso retry grupo ${Date.now()}`);
  await fillCourseFields(page, formatName);
  const groups = page.locator("[data-initial-groups]");
  await groups.getByRole("button", { name: "Añadir grupo" }).click();
  await groups.getByRole("button", { name: "Añadir grupo" }).click();
  const initialGroups = groups.locator("[data-initial-group]");
  await initialGroups.nth(0).locator('[name="initialGroupTime"]').fill("16:00");
  await initialGroups
    .nth(0)
    .locator('[name="initialGroupCapacity"]')
    .fill("20");
  await initialGroups.nth(1).locator('[name="initialGroupTime"]').fill("18:00");
  await initialGroups
    .nth(1)
    .locator('[name="initialGroupCapacity"]')
    .fill("20");

  let lostResponse = false;
  await page.route("**/app/cursos/*/grupos", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && !lostResponse) {
      lostResponse = true;
      await route.fetch();
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await expect(
    page.getByRole("button", { name: "Reintentar pendientes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reintentar pendientes" }).click();
  await expect(page).toHaveURL(/\/grupos(?:\?success=created)?$/);
  await expect(page.locator("[data-group-id]")).toHaveCount(2);
  await expect(
    page.locator("[data-group-id]").filter({ hasText: "16:00" }),
  ).toHaveCount(1);
  await expect(
    page.locator("[data-group-id]").filter({ hasText: "18:00" }),
  ).toHaveCount(1);
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
  await page.getByLabel("Duración de sesión (minutos)").fill("90");
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
  const startDate = page.getByLabel("Fecha de inicio de clases (Bolivia)");
  await startDate.focus();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await expect(startDate).toHaveValue("2027-03-01");
  await page.evaluate(() => navigator.clipboard.writeText("bad/date"));
  await startDate.press("ControlOrMeta+A");
  await startDate.press("ControlOrMeta+V");
  await expect(startDate).toHaveValue("2027-03-01");
  await expect(create).toBeEnabled();
  await startDate.fill("2027-03-06");
  await expect(create).toBeDisabled();
  await startDate.fill("2020-03-01");
  await expect(create).toBeDisabled();
  await startDate.fill("2027-03-01");
  await expect(create).toBeEnabled();
  await page.getByLabel("Instructor (opcional)").fill("Docente E2E");
  await expect(page.locator('input[name="schedule"]')).toHaveValue(
    "Lunes a viernes · horario por grupo",
  );
  await page
    .getByLabel("Contenido del curso (Markdown, opcional)")
    .fill("## Temario\n- Unidad uno");
  await page.evaluate(() => {
    (window as Window & { navigationMarker?: boolean }).navigationMarker = true;
  });
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await expect(page).toHaveURL(/\/app\/cursos\/[^/]+\/editar$/);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
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
  const courseStart = page.getByLabel("Fecha de inicio de clases (Bolivia)");
  await courseStart.fill("2027-03-06");
  await expect(save).toBeDisabled();
  await courseStart.fill("2027-03-01");
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
  const persistedRevision = await page
    .locator('input[name="revision"]')
    .inputValue();
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
  await page.locator('input[name="revision"]').evaluate((input, revision) => {
    (input as HTMLInputElement).value = revision;
  }, persistedRevision);
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
  await courseStart.fill("2027-03-02");
  await expect(save).toBeEnabled();
  await courseStart.fill("2027-03-01");
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
    page.getByLabel("Fecha de inicio de clases (Bolivia)"),
  ).toHaveValue("2027-03-01");
  await expect(page.locator('input[name="startsAt"]')).toHaveValue(
    "2027-03-01T00:00",
  );
  await expect(
    page.getByLabel("Apertura de preinscripción", { exact: true }),
  ).toHaveValue("01/01/2027");
  await expect(page.getByLabel("Instructor (opcional)")).toHaveValue(
    "Docente E2E",
  );
  await expect(page.locator('input[name="schedule"]')).toHaveValue(
    "Lunes a viernes · horario por grupo",
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
  await page
    .getByLabel("Descripción")
    .fill("Contenido actualizado antes de publicar.");
  const editUrl = page.url();
  await page.evaluate(() => {
    (window as Window & { navigationMarker?: boolean }).navigationMarker = true;
  });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Cambios guardados",
  );
  expect(page.url()).toBe(editUrl);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
  await expect(page.locator('input[name="schedule"]')).toHaveValue(
    "Lunes a viernes · horario por grupo",
  );
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Cambios guardados",
  );
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Publicar curso" }).click();
  const dialog = page.getByRole("dialog", { name: "Publicar curso" });
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publicar curso" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Publicar curso" }).click();
  const publishedElsewhere = await page.request.post(
    new URL(page.url()).pathname,
    {
      headers: {
        Origin: new URL(page.url()).origin,
        Accept: "application/json",
      },
      form: { intent: "publish" },
    },
  );
  expect(publishedElsewhere.status()).toBe(200);
  await dialog.getByRole("button", { name: "Confirmar publicación" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /PUBLISHED/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publicar curso" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
  const withdrawnElsewhere = await page.request.post(
    new URL(page.url()).pathname,
    {
      headers: {
        Origin: new URL(page.url()).origin,
        Accept: "application/json",
      },
      form: { intent: "withdraw" },
    },
  );
  expect(withdrawnElsewhere.status()).toBe(200);
  await page.getByRole("button", { name: "Publicar curso" }).click();
  await dialog.getByRole("button", { name: "Confirmar publicación" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Publicado$/ })
      .first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Curso publicado",
  );
  await page.getByRole("button", { name: "Destacar en la cartelera" }).click();
  await expect(page.getByText("Destacado en la cartelera")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Destacado en la cartelera")).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { navigationMarker?: boolean }).navigationMarker = true;
  });

  await page.getByRole("button", { name: "Retirar publicación" }).click();
  await page
    .getByRole("dialog", { name: "Retirar publicación" })
    .getByRole("button", { name: "Confirmar retiro" })
    .click();
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "devuelto a borrador",
  );
  await page.getByRole("button", { name: "Archivar curso" }).click();
  await page
    .getByRole("dialog", { name: "Archivar curso" })
    .getByRole("button", { name: "Confirmar archivo" })
    .click();
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Curso archivado",
  );
  await expect(page.getByLabel("Nombre")).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
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
