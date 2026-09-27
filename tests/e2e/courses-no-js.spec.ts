import { expect, test } from "@playwright/test";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test.use({ javaScriptEnabled: false });

test("new courses preserve values and can be corrected after server validation without JavaScript", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const formatName = `Formato curso sin JavaScript ${Date.now()}`;
  await page.goto("/app/formatos");
  await page.getByRole("link", { name: "Nuevo formato" }).click();
  const format = page.getByRole("form", { name: "Crear formato" });
  await format.getByLabel("Nombre").fill(formatName);
  await format.getByLabel("Duración total (horas)").fill("24");
  await format.getByLabel("Duración de sesión (minutos)").fill("90");
  await format.getByLabel("Precio estudiante (BOB)").fill("80");
  await format.getByLabel("Precio externo (BOB)").fill("100");
  await format.getByRole("button", { name: "Crear formato" }).click();

  await page.goto("/app/cursos/nuevo");
  const course = page.locator("form.course-form");
  const courseName = `Curso sin JavaScript ${Date.now()}`;
  const uniqueFields = [
    "startsAt",
    "endsAt",
    "registrationStartAt",
    "registrationEndAt",
    "contentMarkdown",
    "schedule",
  ];
  for (const name of uniqueFields) {
    await expect(course.locator(`[name="${name}"]`)).toHaveCount(1);
  }
  await course.getByLabel("Nombre").fill(courseName);
  await course
    .getByLabel("Descripción")
    .fill("Contenido para probar la recuperación tras validar en servidor.");
  await course.getByLabel("Nivel").selectOption("INTERMEDIATE");
  await course
    .getByLabel("Formato de curso")
    .selectOption({ label: formatName });
  await course
    .getByLabel(/Horario calculado/)
    .fill("Lunes a viernes, 18:30–20:00");
  await course.getByLabel("Condiciones").fill("Sujeto a confirmación de cupo.");
  await course
    .getByLabel("Inicio del curso (AAAA-MM-DDTHH:mm)", { exact: true })
    .fill("2027-03-01T18:30");
  await course
    .getByLabel("Finalización del curso (AAAA-MM-DDTHH:mm)", { exact: true })
    .fill("2027-03-22T20:00");
  expect(
    await course.evaluate((form: HTMLFormElement, names: string[]) => {
      const data = new FormData(form);
      return Object.fromEntries(
        names.map((name) => [name, data.getAll(name).length]),
      );
    }, uniqueFields),
  ).toEqual(Object.fromEntries(uniqueFields.map((name) => [name, 1])));
  await course.getByLabel("Nota mínima (0–100)").fill("101");
  const selectedFormat = await course
    .getByLabel("Formato de curso")
    .inputValue();
  const invalidPost = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/app/cursos/nuevo"),
  );
  await course.getByRole("button", { name: "Crear borrador" }).click();

  expect((await invalidPost).status()).toBe(422);
  await expect(page).toHaveURL("/app/cursos/nuevo");
  await expect(page.getByRole("alert")).toContainText("Revisa los campos");
  await expect(
    course.getByRole("button", { name: "Crear borrador" }),
  ).toBeEnabled();
  await expect(course.getByLabel("Nombre")).toHaveValue(courseName);
  await expect(course.getByLabel("Descripción")).toHaveValue(
    "Contenido para probar la recuperación tras validar en servidor.",
  );
  await expect(course.getByLabel("Nivel")).toHaveValue("INTERMEDIATE");
  await expect(course.getByLabel("Formato de curso")).toHaveValue(
    selectedFormat,
  );
  await expect(course.getByLabel(/Horario calculado/)).toHaveValue(
    "Lunes a viernes, 18:30–20:00",
  );
  await expect(
    course.getByLabel("Inicio del curso (AAAA-MM-DDTHH:mm)", { exact: true }),
  ).toHaveValue("2027-03-01T18:30");
  await expect(
    course.getByLabel("Finalización del curso (AAAA-MM-DDTHH:mm)", {
      exact: true,
    }),
  ).toHaveValue("2027-03-22T20:00");
  await expect(course.getByLabel("Nota mínima (0–100)")).toHaveValue("101");

  await course.getByLabel("Nota mínima (0–100)").fill("70");
  await course.getByRole("button", { name: "Crear borrador" }).click();
  await expect(page).toHaveURL(
    /\/app\/cursos\/[0-9a-f-]+\/editar\?success=created/,
  );
  await expect(page.getByLabel("Nombre")).toHaveValue(courseName);
});

test("unused formats can be created, edited and deleted without JavaScript", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.mobileMultiRole.email);
  await page.goto("/app/formatos");
  await page.getByRole("link", { name: "Nuevo formato" }).click();
  const name = `Formato sin JavaScript ${Date.now()}`;
  const create = page.getByRole("form", { name: "Crear formato" });
  await create.getByLabel("Nombre").fill(name);
  await create.getByLabel("Duración total (horas)").fill("24");
  await create.getByLabel("Duración de sesión (minutos)").fill("90");
  await create.getByLabel("Precio estudiante (BOB)").fill("invalid");
  await create.getByLabel("Precio externo (BOB)").fill("100");
  await create.getByRole("button", { name: "Crear formato" }).click();
  expect(
    await create
      .getByLabel("Precio estudiante (BOB)")
      .evaluate((input: HTMLInputElement) => input.validity.patternMismatch),
  ).toBe(true);
  await expect(create.getByLabel("Nombre")).toHaveValue(name);
  const invalidServerResponse = await page.request.post("/app/formatos/nuevo", {
    form: {
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
  await expect(page).toHaveURL(/success=created/);
  const card = page.getByRole("link", { name: new RegExp(name) });
  await expect(card).toContainText("24 horas");
  await card.click();
  await page.locator('summary[aria-label="Editar duración total"]').click();
  const hours = page.getByRole("form", { name: "Editar duración total" });
  await hours.getByLabel("Nueva duración total").fill("30");
  await hours.getByRole("button", { name: "Guardar duración total" }).click();
  await expect(page).toHaveURL(/success=revise/);
  await expect(page.getByText("30 horas")).toBeVisible();
  await expect(page.locator("[data-format-status]")).toHaveText("Activo");
  const path = new URL(page.url()).pathname;
  const deactivated = await page.request.post(path, {
    headers: { Origin: "http://127.0.0.1:4321", Accept: "application/json" },
    form: {
      intent: "deactivate",
      revisionId: await page
        .locator('input[name="revisionId"]')
        .first()
        .inputValue(),
      updatedAt: await page
        .locator('input[name="updatedAt"]')
        .first()
        .inputValue(),
    },
  });
  expect(deactivated.status()).toBe(200);
  await page.reload();
  await expect(page.locator("[data-format-status]")).toHaveText("Inactivo");
  await expect(
    page.locator('summary[aria-label="Editar nombre"]'),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Activar formato" }),
  ).toHaveCount(0);
  await page.locator("[data-action-fallback] summary").click();
  await page
    .locator("[data-action-fallback]")
    .getByRole("link", { name: "Cancelar" })
    .click();
  await expect(page).toHaveURL(path);
  await page.locator("[data-action-fallback] summary").click();
  await expect(
    page.getByRole("button", { name: "Sí, eliminar formato" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sí, eliminar formato" }).click();
  await expect(page).toHaveURL(/success=deleted/);
  await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(
    0,
  );
});

test("used formats require confirmation to deactivate without JavaScript", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/formatos/nuevo");
  const name = `Formato usado sin JS ${Date.now()}`;
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Duración total (horas)").fill("20");
  await page.getByLabel("Duración de sesión (minutos)").fill("90");
  await page.getByLabel("Precio estudiante (BOB)").fill("80");
  await page.getByLabel("Precio externo (BOB)").fill("100");
  await page.getByRole("button", { name: "Crear formato" }).click();
  await page.getByRole("link", { name: new RegExp(name) }).click();
  const path = new URL(page.url()).pathname;
  const course = await page.request.post("/app/cursos/nuevo", {
    headers: { Origin: "http://127.0.0.1:4321", Accept: "application/json" },
    form: {
      name: `Curso sin JS ${Date.now()}`,
      description: "Curso asociado para comprobar la confirmación.",
      level: "INTERMEDIATE",
      courseTypeId: path.split("/").at(-1)!,
      schedule: "Lunes a viernes, 16:00–17:30",
      conditions: "Sujeto a cupo.",
      startsAt: "2027-03-01T16:00",
      endsAt: "2027-03-17T17:30",
      weekdays: "1,2,3,4,5",
      minimumGrade: "70",
    },
  });
  expect(course.status()).toBe(201);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Eliminar formato" }),
  ).toHaveCount(0);
  await page.locator("[data-action-fallback] summary").click();
  await expect(
    page.getByRole("button", { name: "Sí, desactivar formato" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Cancelar" }).click();
  await expect(page.locator("[data-format-status]")).toHaveText("Activo");
  await page.locator("[data-action-fallback] summary").click();
  await page.getByRole("button", { name: "Sí, desactivar formato" }).click();
  await expect(page.locator("[data-format-status]")).toHaveText("Inactivo");
  await page.getByRole("button", { name: "Activar formato" }).click();
  await expect(page.locator("[data-format-status]")).toHaveText("Activo");
  await expect(page).toHaveURL(/success=activate/);
});

test("format mutations reject stale revisions, invalid origins and non-admin users", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/formatos/nuevo");
  const name = `Formato concurrencia ${Date.now()}`;
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Duración total (horas)").fill("20");
  await page.getByLabel("Duración de sesión (minutos)").fill("90");
  await page.getByLabel("Precio estudiante (BOB)").fill("80");
  await page.getByLabel("Precio externo (BOB)").fill("100");
  await page.getByRole("button", { name: "Crear formato" }).click();
  await page.getByRole("link", { name: new RegExp(name) }).click();
  const path = new URL(page.url()).pathname;
  const revisionId = await page
    .locator('input[name="revisionId"]')
    .first()
    .inputValue();
  const updatedAt = await page
    .locator('input[name="updatedAt"]')
    .first()
    .inputValue();
  const headers = { Origin: "http://127.0.0.1:4321" };
  const post = (form: Record<string, string>) =>
    page.request.post(path, { form, headers, maxRedirects: 0 });
  expect(
    (
      await post({
        intent: "rename",
        field: "name",
        value: `${name} editado`,
        revisionId,
        updatedAt,
      })
    ).status(),
  ).toBe(303);
  const stale = await post({ intent: "delete", revisionId, updatedAt });
  expect(stale.status()).toBe(409);
  expect(await stale.text()).toContain("Recarga y revisa");
  expect(
    (
      await page.request.post(path, {
        form: { intent: "delete", revisionId, updatedAt },
      })
    ).status(),
  ).toBe(403);
  await context.clearCookies();
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto(path);
  await expect(page).toHaveURL(/unauthorized\?reason=forbidden/);
  const denied = await post({ intent: "delete", revisionId, updatedAt });
  expect(denied.status()).toBe(303);
  expect(denied.headers().location).toContain("/unauthorized?reason=forbidden");
});
