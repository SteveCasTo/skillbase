import { randomUUID } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";
import {
  registerCourseInstructor,
  chooseCourseInstructor,
  courseInstructor,
} from "./instructor-helper";
test.beforeEach(async ({ page }) => {
  await registerCourseInstructor(page);
});

function fixtureSuffix(testInfo: TestInfo): string {
  return `${testInfo.parallelIndex}-${testInfo.retry}-${testInfo.repeatEachIndex}-${randomUUID()}`;
}

// Capture the committed ID even when the simulated network failure hides it
// from the browser. Failed attempts must not leave this course published.
const lifecycleCourseIds = new Map<string, string>();

test.afterEach(async ({ page }, testInfo) => {
  const id = lifecycleCourseIds.get(testInfo.testId);
  lifecycleCourseIds.delete(testInfo.testId);
  if (!id || testInfo.status === testInfo.expectedStatus) return;
  getTestSupabaseEnvironment(); // Refuse cleanup outside the runner's isolated stack.
  const path = `/app/cursos/${id}/editar`;
  const response = await page.request.get(path);
  expect(response.ok()).toBe(true);
  const persisted = await page.evaluate(
    (html) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      return {
        status: document
          .querySelector("[data-course-status]")
          ?.textContent?.trim(),
        revision: document.querySelector<HTMLInputElement>(
          '.course-form input[name="revision"]',
        )?.value,
      };
    },
    await response.text(),
  );
  if (persisted.status === "Archivado") return;
  expect(persisted.revision).toBeTruthy();
  const archived = await page.request.post(path, {
    headers: {
      Accept: "application/json",
      Origin: new URL(page.url()).origin,
    },
    form: { intent: "archive", revision: persisted.revision! },
  });
  expect(archived.status()).toBe(200);
  expect((await archived.json()).status).toBe("ARCHIVED");
});

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
  await page
    .getByRole("option", {
      name: new RegExp(formatName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    })
    .click();
  await page.getByLabel("Condiciones").fill("Sujeto a confirmación de cupo.");
  for (const [label, date] of [
    ["Apertura de preinscripción", "01/01/2027"],
    ["Último día de preinscripción", "20/02/2027"],
  ] as const) {
    await page.getByRole("textbox", { name: label, exact: true }).fill(date);
  }
  await page
    .getByRole("textbox", {
      name: "Fecha de inicio de clases (Bolivia)",
      exact: true,
    })
    .fill("01/03/2027");
  await expect(
    page.getByText("17/03/2027", { exact: false }).first(),
  ).toBeVisible();
  await page.getByLabel("Nota mínima (0–100)").fill("70");
}

test("missing format is announced beside the selector and focuses it without an artwork error", async ({
  page,
  context,
}, testInfo) => {
  const suffix = fixtureSuffix(testInfo);
  const formatName = `Formato sin selección ${suffix}`;
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  // This test must not depend on formats created by another spec or test.
  await page.goto("/app/formatos");
  await page.getByRole("link", { name: "Nuevo formato" }).click();
  const formatForm = page.getByRole("form", { name: "Crear formato" });
  await formatForm.getByLabel("Nombre").fill(formatName);
  await formatForm.getByLabel("Duración total (horas)").fill("20");
  await page.getByLabel("Duración de sesión (minutos)").fill("90");
  await formatForm.getByLabel("Precio estudiante (BOB)").fill("80");
  await formatForm.getByLabel("Precio externo (BOB)").fill("100");
  await formatForm.getByRole("button", { name: "Crear formato" }).click();
  await expect(page).toHaveURL(/\/app\/formatos$/);
  await page.goto("/app/cursos/nuevo");
  const create = page.getByRole("button", { name: "Crear borrador" });
  await page.getByLabel("Nombre").fill(`Curso sin formato ${suffix}`);
  await expect(create).toBeEnabled();
  await create.click();
  const format = page.getByRole("combobox", { name: "Formato de curso" });
  await expect(format).toBeFocused();
  await expect(format).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("[data-format-error]")).toHaveText(
    "Selecciona un formato de curso.",
  );
  await expect(page.locator(".artwork-create-error")).toBeHidden();
  await format.click();
  await page
    .getByRole("option", {
      name: new RegExp(formatName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    })
    .click();
  await expect(page.locator("[data-format-error]")).toBeHidden();
});

test("admin crops a photo in the new-course form and can retry a failed upload without creating another draft", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const suffix = fixtureSuffix(testInfo);
  const formatName = `Formato foto ${suffix}`;
  const courseName = `Curso con foto ${suffix}`;
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
  await page.getByLabel("Nombre").fill(courseName);
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
  await expect(
    initialGroups.nth(0).locator("[data-initial-group-end]"),
  ).toHaveText("Fin 17:30");
  await expect(
    initialGroups.nth(1).locator("[data-initial-group-end]"),
  ).toHaveText("Fin 19:30");
  const firstTime = await initialGroups
    .nth(0)
    .locator('[name="initialGroupTime"]')
    .boundingBox();
  const firstCapacity = await initialGroups
    .nth(0)
    .locator('[name="initialGroupCapacity"]')
    .boundingBox();
  if (page.viewportSize()!.width >= 640)
    expect(firstTime!.y).toBeCloseTo(firstCapacity!.y, 0);
  await initialGroups.nth(1).locator('[name="initialGroupTime"]').fill("17:00");
  await expect(groups.locator("[data-initial-group-error]")).toContainText(
    "no pueden solaparse",
  );
  await expect(
    page.getByRole("button", { name: "Crear borrador" }),
  ).toBeDisabled();
  await initialGroups.nth(1).locator('[name="initialGroupTime"]').fill("18:00");
  await expect(groups.locator("[data-initial-group-error]")).toBeHidden();
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
  const cropImage = cropDialog.locator('img[draggable="false"]');
  const initialImageBox = await cropImage.boundingBox();
  expect(initialImageBox).not.toBeNull();
  const contexts = cropDialog.getByRole("region", {
    name: "Vistas previas públicas",
  });
  await expect(contexts.getByText("Destacado en escritorio")).toBeVisible();
  const previewImage = contexts.locator("img").first();
  const initialPreview = await previewImage.getAttribute("src");
  expect(initialPreview).toMatch(/^blob:/);
  await contexts.getByRole("button", { name: "Afiches" }).click();
  await expect(contexts.getByText("Afiche ancho")).toBeVisible();
  await expect(contexts.getByText("Afiche estrecho")).toBeVisible();
  await contexts.getByRole("button", { name: "Móvil" }).click();
  await expect(contexts.getByText("Destacado móvil")).toBeVisible();
  await expect(contexts.getByText("Otro curso móvil")).toBeVisible();
  await contexts.getByRole("button", { name: "Detalle" }).click();
  await expect(contexts.getByText("Detalle en escritorio")).toBeVisible();
  await expect(contexts.getByText("Detalle en móvil")).toBeVisible();
  const [desktopDetail, mobileDetail] = await Promise.all([
    contexts.locator(".artwork-context-first").boundingBox(),
    contexts.locator(".artwork-context-second").boundingBox(),
  ]);
  expect(desktopDetail).not.toBeNull();
  expect(mobileDetail).not.toBeNull();
  expect(desktopDetail!.width).toBeGreaterThan(mobileDetail!.width);
  expect(desktopDetail!.width / desktopDetail!.height).toBeCloseTo(1.15, 1);
  const zoom = cropDialog.getByRole("slider", { name: "Zoom" });
  await zoom.fill("1.5");
  await expect
    .poll(() => previewImage.getAttribute("src"))
    .not.toBe(initialPreview);
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
    .getByRole("textbox", {
      name: "Fecha de inicio de clases (Bolivia)",
      exact: true,
    })
    .fill("06/03/2027");
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
  await expect(page.getByLabel("Nombre")).toHaveValue(courseName);
  await expect(
    page.getByRole("img", { name: "Vista previa del recorte del curso" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", {
      name: "Fecha de inicio de clases (Bolivia)",
      exact: true,
    })
    .fill("01/03/2027");
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
  let associations = 0;
  let recoveryReads = 0;
  await page.route(`**${draftUrl}`, async (route) => {
    if (route.request().method() === "POST") {
      associations++;
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      await route.abort("failed"); // Commit succeeded, but the client never received its revision.
    } else {
      recoveryReads++;
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Reintentar pendientes" }).click();
  await expect(page.locator(".artwork-create-error")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reintentar pendientes" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Reintentar pendientes" }).click();
  await expect(page).toHaveURL(/\/grupos(?:\?success=created)?$/);
  expect(associations).toBe(1);
  expect(recoveryReads).toBe(1);
  await page.unroute(`**${draftUrl}`);
  await expect(page.locator("[data-group-id]")).toHaveCount(2);
  await page.goto(draftUrl!);
  const artwork = page.locator('input[name="artwork"]');
  const key = await artwork.inputValue();
  expect(key).toMatch(/^courses\/[0-9a-f-]+\/[0-9a-f-]+\.webp$/);
  // The editor and persisted photo must be present in the server response,
  // rather than disappearing until the React islands finish loading.
  const editHtml = await (await page.request.get(draftUrl!)).text();
  expect(editHtml).toContain('id="contentMarkdown"');
  expect(editHtml).toContain('data-course-image-editor="true"');
  expect(editHtml).toContain("Foto actual del curso");
  expect(editHtml).toContain(key);
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
}, testInfo) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const suffix = fixtureSuffix(testInfo);
  const formatName = `Formato retry grupo ${suffix}`;
  await page.goto("/app/formatos");
  await page.getByRole("link", { name: "Nuevo formato" }).click();
  const format = page.getByRole("form", { name: "Crear formato" });
  await format.getByLabel("Nombre").fill(formatName);
  await format.getByLabel("Duración total (horas)").fill("20");
  await format.getByLabel("Duración de sesión (minutos)").fill("90");
  await format.getByLabel("Precio estudiante (BOB)").fill("80");
  await format.getByLabel("Precio externo (BOB)").fill("100");
  await format.getByRole("button", { name: "Crear formato" }).click();
  await expect(page).toHaveURL(/\/app\/formatos$/);
  await expect(
    page.locator("[data-sileo-toast]").filter({ hasText: "Formato creado" }),
  ).toBeVisible();
  await page.goto("/app/cursos/nuevo");
  await page.getByLabel("Nombre").fill(`Curso retry grupo ${suffix}`);
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
}, testInfo) => {
  test.setTimeout(90_000);
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const suffix = fixtureSuffix(testInfo);
  const formatName = `Formato E2E ${suffix}`;
  const courseName = `Curso E2E conservación ${suffix}`;
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
  await expect(
    page.locator("[data-sileo-toast]").filter({ hasText: "Formato creado" }),
  ).toBeVisible();
  await page.goto("/app/cursos/nuevo");
  const create = page.getByRole("button", { name: "Crear borrador" });
  // SSR keeps the form usable without JS; wait until client validation takes over.
  await expect(page.locator(".course-form")).toHaveAttribute(
    "data-validation-initialized",
    "true",
  );
  await expect(create).toBeDisabled();
  await page.getByLabel("Nombre").fill(courseName);
  await expect(create).toBeEnabled();
  await expect(page).toHaveURL(/\/app\/cursos\/nuevo$/);
  await expect(page.getByLabel("Nombre")).toHaveValue(courseName);

  await fillCourseFields(page, formatName);
  await expect(create).toBeEnabled();
  await chooseCourseInstructor(page);
  await expect(create).toBeEnabled();
  await page.getByRole("combobox", { name: "Instructor", exact: true }).click();
  await page
    .getByRole("option", { name: "Sin asignar (solo borrador)", exact: true })
    .click();
  await page.getByLabel("Condiciones").clear();
  await expect(create).toBeDisabled();
  await page.getByLabel("Condiciones").fill("Sujeto a confirmación de cupo.");
  await expect(create).toBeEnabled();
  const startCalendar = page.getByRole("button", {
    name: /Elegir fecha de fecha de inicio de clases/i,
  });
  await startCalendar.click();
  const calendar = page.locator('[data-slot="calendar"]:visible');
  for (let month = 0; month < 12; month++) {
    if (
      /marzo(?: de)? 2027/i.test(
        await calendar.locator(".rdp-month_caption").innerText(),
      )
    )
      break;
    await calendar.locator(".rdp-button_next").click();
  }
  await expect(calendar.locator(".rdp-month_caption")).toContainText(
    /marzo.*2027/i,
  );
  await expect(calendar.locator('[data-day="3/6/2027"]')).toBeDisabled();
  await calendar.locator('[data-day="3/1/2027"]').click();
  await expect(page.locator('[name="startDate"]')).toHaveValue("2027-03-01");
  const registrationEndCalendar = page.getByRole("button", {
    name: /Elegir fecha de último día de preinscripción/i,
  });
  await registrationEndCalendar.click();
  const registrationCalendar = page.locator('[data-slot="calendar"]:visible');
  for (let month = 0; month < 12; month++) {
    if (
      /marzo(?: de)? 2027/i.test(
        await registrationCalendar.locator(".rdp-month_caption").innerText(),
      )
    )
      break;
    await registrationCalendar.locator(".rdp-button_next").click();
  }
  await expect(
    registrationCalendar.locator('[data-day="3/1/2027"]'),
  ).toBeDisabled();
  await registrationCalendar.locator(".rdp-button_previous").click();
  await registrationCalendar.locator('[data-day="2/20/2027"]').click();
  await expect(page.locator('[name="registrationEndDate"]')).toHaveValue(
    "2027-02-20",
  );
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
  const startDate = page.getByRole("textbox", {
    name: "Fecha de inicio de clases (Bolivia)",
    exact: true,
  });
  await startDate.focus();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await expect(startDate).toHaveValue("01/03/2027");
  await page.evaluate(() => navigator.clipboard.writeText("bad/date"));
  await startDate.press("ControlOrMeta+A");
  await startDate.press("ControlOrMeta+V");
  await expect(startDate).toHaveValue("01/03/2027");
  await expect(create).toBeEnabled();
  await startDate.fill("06/03/2027");
  await expect(create).toBeDisabled();
  await startDate.fill("01/03/2020");
  await expect(create).toBeDisabled();
  await startDate.fill("01/03/2027");
  await expect(create).toBeEnabled();
  await chooseCourseInstructor(page);
  await expect(page.locator('input[name="schedule"]')).toHaveValue(
    "Lunes a viernes · horario por grupo",
  );
  await page
    .getByLabel("Contenido del curso (Markdown, opcional)")
    .fill("## Temario\n- Unidad uno");
  await page.evaluate(() => {
    (window as Window & { navigationMarker?: boolean }).navigationMarker = true;
  });
  const creationKey = await page
    .locator('input[name="requestKey"]')
    .inputValue();
  const createdIds: string[] = [];
  await page.route("**/app/cursos/nuevo", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    expect(route.request().postData()).toContain(creationKey);
    const committed = await route.fetch();
    expect(committed.status()).toBe(201);
    const id: string = (await committed.json()).id;
    createdIds.push(id);
    lifecycleCourseIds.set(testInfo.testId, id);
    if (createdIds.length === 1) await route.abort("failed");
    else await route.fulfill({ response: committed });
  });
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await expect(
    page.getByRole("button", { name: "Reintentar creación" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Crear borrador" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Reintentar creación" }).click();
  await expect(page).toHaveURL(/\/app\/cursos\/[^/]+\/editar$/);
  expect(createdIds).toHaveLength(2);
  expect(createdIds[1]).toBe(createdIds[0]);
  await page.unroute("**/app/cursos/nuevo");
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
  await expect(
    page.locator("[data-sileo-toast]").filter({ hasText: "Borrador creado" }),
  ).toBeVisible();
  const savedCourseEditUrl = page.url();
  await page.goto("/app/cursos");
  const savedCourseCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: courseName, exact: true }),
  });
  await expect(savedCourseCard).toHaveCount(1);
  await expect(savedCourseCard).toBeVisible();
  await expect(savedCourseCard.getByRole("link")).toHaveAttribute(
    "href",
    `/app/cursos/${createdIds[0]}/editar`,
  );
  await page.goto(savedCourseEditUrl);
  const save = page
    .locator(".course-form")
    .getByRole("button", { name: /^(Guardar cambios|Guardando…)$/ });
  await expect(save).toBeDisabled();
  await page.getByLabel("Nombre").fill("Curso temporalmente inválido");
  await page.getByLabel("Nombre").clear();
  await expect(save).toBeDisabled();
  await page.getByLabel("Nombre").fill(courseName);
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
  const courseStart = page.getByRole("textbox", {
    name: "Fecha de inicio de clases (Bolivia)",
    exact: true,
  });
  await expect(
    page.getByRole("button", {
      name: /Elegir fecha de fecha de inicio de clases/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Elegir fecha de apertura de preinscripción/i,
    }),
  ).toBeVisible();
  await courseStart.fill("06/03/2027");
  await expect(save).toBeDisabled();
  await courseStart.fill("01/03/2027");
  await expect(save).toBeEnabled();
  await page.getByLabel("Nombre").fill(courseName);
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
    .locator('.course-form input[name="revision"]')
    .inputValue();
  await page
    .locator('.course-form input[name="revision"]')
    .evaluate((input) => {
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
    .locator('.course-form input[name="revision"]')
    .evaluate((input, revision) => {
      (input as HTMLInputElement).value = revision;
    }, persistedRevision);
  await page
    .getByLabel("Descripción")
    .fill("Contenido determinista para validar el flujo administrativo.");
  await page.getByLabel("Nombre").fill("Curso E2E editado");
  await expect(save).toBeEnabled();
  await page.getByLabel("Nombre").fill(courseName);
  await expect(save).toBeDisabled();
  await page.getByRole("combobox", { name: "Nivel" }).click();
  await page.getByRole("option", { name: "Básico" }).click();
  await expect(save).toBeEnabled();
  await page.getByRole("combobox", { name: "Nivel" }).click();
  await page.getByRole("option", { name: "Medio" }).click();
  await expect(save).toBeDisabled();
  await courseStart.fill("02/03/2027");
  await expect(save).toBeEnabled();
  await courseStart.fill("01/03/2027");
  await expect(save).toBeDisabled();
  const markdown = page.getByLabel("Contenido del curso (Markdown, opcional)");
  await markdown.fill("## Temario\n- Unidad uno\nNota");
  await expect(save).toBeEnabled();
  await markdown.fill("## Temario\n- Unidad uno");
  await expect(save).toBeDisabled();
  await markdown.selectText();
  await page.getByRole("button", { name: "Negrita" }).click();
  await expect(markdown).toHaveValue(/\*\*/u);
  await expect(save).toBeEnabled();
  await markdown.fill("## Temario\n- Unidad uno");
  await expect(markdown).toHaveValue("## Temario\n- Unidad uno");
  await expect(save).toBeDisabled();
  await expect(
    page.getByRole("textbox", {
      name: "Fecha de inicio de clases (Bolivia)",
      exact: true,
    }),
  ).toHaveValue("01/03/2027");
  await expect(page.locator('input[name="startsAt"]')).toHaveValue(
    "2027-03-01T00:00",
  );
  await expect(
    page.getByLabel("Apertura de preinscripción", { exact: true }),
  ).toHaveValue("01/01/2027");
  await expect(
    page.getByRole("textbox", {
      name: "Último día de preinscripción",
      exact: true,
    }),
  ).toHaveValue("20/02/2027");
  await expect(page.locator('[name="registrationStartDate"]')).toHaveValue(
    "2027-01-01",
  );
  await expect(page.locator('[name="registrationEndDate"]')).toHaveValue(
    "2027-02-20",
  );
  await expect(
    page.getByRole("combobox", { name: "Instructor", exact: true }),
  ).toHaveText(courseInstructor(page).name);
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
  await expect(markdown).toBeVisible();
  await expect(markdown).toHaveValue("## Temario\n- Unidad uno");
  await expect(page.getByLabel("Nombre")).toHaveValue(courseName);
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
  await page.route(`**${new URL(editUrl).pathname}`, async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ revision: true, name: "Invalid reply" }),
      });
    else await route.continue();
  });
  await save.click();
  await expect(page.locator("[data-save-error]")).toBeVisible();
  await expect(save).toBeEnabled();
  await expect(
    page
      .locator("[data-sileo-toast]")
      .filter({ hasText: "Cambios guardados correctamente" }),
  ).toHaveCount(0);
  await page.unroute(`**${new URL(editUrl).pathname}`);
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const savePath = new URL(editUrl).pathname;
  let saveAndPublishGets = 0;
  const countRefresh = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname === savePath
    )
      saveAndPublishGets++;
  };
  page.on("request", countRefresh);
  await page.route(`**${savePath}`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await saveGate;
    await route.fulfill({ response });
  });
  await page.evaluate(() => {
    (window as Window & { navigationMarker?: boolean }).navigationMarker = true;
  });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page
      .locator('[data-sileo-toast][data-state="loading"]')
      .filter({ hasText: "Guardando" }),
  ).toBeVisible();
  await page.getByLabel("Descripción").fill("Edición mientras se guarda");
  await expect(save).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Publicar curso", exact: true }),
  ).toBeDisabled();
  const saveIntentCount = { count: 0 };
  const countEditorial = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === savePath
    )
      saveIntentCount.count++;
  };
  page.on("request", countEditorial);
  await page.locator("[data-course-dialog-form]").evaluate((form) => {
    form.querySelector<HTMLInputElement>('input[name="intent"]')!.value =
      "publish";
    form.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );
  });
  expect(saveIntentCount.count).toBe(0);
  page.off("request", countEditorial);
  releaseSave();
  await expect(
    page.locator("[data-sileo-toast]").filter({ hasText: "Cambios guardados" }),
  ).toBeVisible();
  expect(page.url()).toBe(editUrl);
  await expect(page.getByLabel("Descripción")).toHaveValue(
    "Edición mientras se guarda",
  );
  await expect(save).toBeEnabled();
  await page
    .getByLabel("Descripción")
    .fill("Contenido actualizado antes de publicar.");
  await page.unroute(`**${savePath}`);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
  await expect(page.locator('input[name="schedule"]')).toHaveValue(
    "Lunes a viernes · horario por grupo",
  );
  await expect(save).toBeDisabled();
  const prerequisite = await page.request.post(
    savePath.replace(/\/editar$/u, "/grupos"),
    {
      headers: {
        Origin: new URL(page.url()).origin,
        Accept: "application/json",
      },
      form: { intent: "create", startTime: "08:00", capacity: "10" },
    },
  );
  expect(prerequisite.status()).toBe(200);
  await page.getByRole("button", { name: "Publicar curso" }).click();
  const publishAfterSave = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === savePath,
  );
  await page
    .getByRole("dialog", { name: "Publicar curso" })
    .getByRole("button", { name: "Confirmar publicación" })
    .click();
  const publicationResult = await publishAfterSave;
  expect(publicationResult.status()).toBe(200);
  const publicationRevision = (await publicationResult.json()).revision;
  await expect(page.locator("[data-course-status]")).toHaveText("Publicado");
  await expect(
    page.getByRole("button", { name: "Retirar publicación" }),
  ).toBeFocused();
  for (const control of await page
    .locator(
      'form[data-course-mutation-id] input[name="revision"], .course-form input[name="revision"]',
    )
    .all())
    await expect(control).toHaveValue(publicationRevision);
  expect(saveAndPublishGets).toBe(0);
  await page.getByRole("button", { name: "Retirar publicación" }).click();
  await page
    .getByRole("dialog", { name: "Retirar publicación" })
    .getByRole("button", { name: "Confirmar retiro" })
    .click();
  await expect(page.locator("[data-course-status]")).toHaveText("Borrador");
  expect(saveAndPublishGets).toBe(0);
  page.off("request", countRefresh);
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
      form: {
        intent: "publish",
        revision: await page
          .locator('.course-form input[name="revision"]')
          .first()
          .inputValue(),
      },
    },
  );
  expect(publishedElsewhere.status()).toBe(200);
  await dialog.getByRole("button", { name: "Confirmar publicación" }).click();
  await expect(
    page.locator("[data-save-error]").filter({ hasText: /El curso cambió/ }),
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
      form: {
        intent: "withdraw",
        revision: (await publishedElsewhere.json()).revision,
      },
    },
  );
  expect(withdrawnElsewhere.status()).toBe(200);
  await page.reload(); // Explicit recovery from an optimistic conflict, not a mutation refresh.
  await page.evaluate(() => {
    (window as Window & { navigationMarker?: boolean }).navigationMarker = true;
  });
  const editorialPath = new URL(page.url()).pathname;
  let editorialGets = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname === editorialPath
    )
      editorialGets++;
  });
  await page.getByLabel("Nombre").evaluate((node) => {
    (window as Window & { retainedCourseInput?: Element }).retainedCourseInput =
      node;
  });
  let releaseEditorial!: () => void;
  let editorialRequests = 0;
  const editorialGate = new Promise<void>((resolve) => {
    releaseEditorial = resolve;
  });
  await page.route(`**${editorialPath}`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    editorialRequests++;
    const response = await route.fetch();
    await editorialGate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Publicar curso" }).click();
  await dialog.getByRole("button", { name: "Confirmar publicación" }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel("Descripción").fill("Cambio durante publicación");
  await expect(save).toBeDisabled();
  await page
    .locator(".course-form")
    .evaluate((form) =>
      form.dispatchEvent(
        new Event("submit", { cancelable: true, bubbles: true }),
      ),
    );
  await expect(
    page.locator("[data-sileo-toast]").filter({ hasText: "Guardando" }),
  ).toBeVisible();
  releaseEditorial();
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
  await expect(
    page.locator("[data-sileo-toast]").filter({ hasText: "Curso publicado" }),
  ).toBeVisible();
  expect(editorialGets).toBe(0);
  expect(editorialRequests).toBe(1);
  expect(
    await page
      .getByLabel("Nombre")
      .evaluate(
        (node) =>
          (window as Window & { retainedCourseInput?: Element })
            .retainedCourseInput === node,
      ),
  ).toBe(true);
  await page.unroute(`**${editorialPath}`);
  await expect(page.getByLabel("Descripción")).toBeFocused();
  await expect(save).toBeEnabled();
  await page
    .getByLabel("Descripción")
    .fill("Contenido actualizado antes de publicar.");
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
  await expect(
    page
      .locator("[data-sileo-toast]")
      .filter({ hasText: "devuelto a borrador" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archivar curso" }).click();
  await page
    .getByRole("dialog", { name: "Archivar curso" })
    .getByRole("button", { name: "Confirmar archivo" })
    .click();
  await expect(
    page.locator("[data-sileo-toast]").filter({ hasText: "Curso archivado" }),
  ).toBeVisible();
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
  const expectNoHorizontalOverflow = async () => {
    const layout = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      return {
        url: window.location.pathname,
        viewportWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflowingElements: Array.from(document.querySelectorAll("body *"))
          .flatMap((element) => {
            const bounds = element.getBoundingClientRect();
            if (bounds.width === 0 || bounds.right <= viewportWidth) return [];
            const styles = getComputedStyle(element);
            return [
              {
                tag: element.tagName,
                id: element.id,
                classes: element.getAttribute("class"),
                width: bounds.width,
                right: bounds.right,
                minWidth: styles.minWidth,
                gridTemplateColumns: styles.gridTemplateColumns,
                text: element.textContent?.trim().slice(0, 120),
              },
            ];
          })
          .slice(0, 30),
      };
    });
    expect(
      layout.scrollWidth,
      JSON.stringify(layout, null, 2),
    ).toBeLessThanOrEqual(layout.viewportWidth);
  };
  await signInFixture(context, AUTH_FIXTURES.multiRole.email);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/cursos");
  await expect(
    page.getByRole("heading", { name: "Cursos", exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  await expect(page.getByRole("link", { name: "Nuevo curso" })).toBeVisible();
  await page.goto("/app/cursos/nuevo");
  await expect(
    page.getByRole("toolbar", { name: "Formato Markdown" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow();
});
