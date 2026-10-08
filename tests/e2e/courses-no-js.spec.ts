import { expect, test } from "@playwright/test";

import { e2eSiteUrl } from "../../scripts/e2e-port";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";
import { registerCourseInstructor } from "./instructor-helper";

test.use({ javaScriptEnabled: false });

test("stale HTML drafts and editorial confirmations retain their rejected revision until explicit reconciliation", async ({
  page,
  context,
  browser,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const initialInstructor = await registerCourseInstructor(page);
  const peerInstructor = await registerCourseInstructor(page);
  const headers = {
    Origin: e2eSiteUrl(),
    Accept: "application/json",
  };
  const format = await page.request.post("/app/formatos/nuevo", {
    headers,
    form: {
      name: `Formato conflicto HTML ${Date.now()}`,
      totalHours: "20",
      sessionMinutes: "90",
      studentAmount: "80",
      externalAmount: "100",
    },
  });
  expect(format.status()).toBe(201);
  const created = await page.request.post("/app/cursos/nuevo", {
    headers,
    form: {
      requestKey: crypto.randomUUID(),
      name: `Curso conflicto HTML ${Date.now()}`,
      description: "Descripción inicial",
      level: "BASIC",
      courseTypeId: (await format.json()).id,
      schedule: "Lunes a viernes, 18:30–20:00",
      weekdays: "1,2,3,4,5",
      startsAt: "2027-03-01T18:30",
      endsAt: "2027-03-17T20:00",
      conditions: "Sujeto a cupo",
      minimumGrade: "70",
      instructorId: initialInstructor.id,
    },
  });
  expect(created.status()).toBe(201);
  const path = `/app/cursos/${(await created.json()).id}/editar`;
  await page.goto(path);
  const form = page.locator("form.course-form");
  const rejectedRevision = await form
    .locator('input[name="revision"]')
    .inputValue();
  const original = await form.evaluate((element) =>
    Object.fromEntries(
      [...new FormData(element as HTMLFormElement)].filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  );
  const peer = await browser.newContext({ javaScriptEnabled: false });
  try {
    await signInFixture(peer, AUTH_FIXTURES.multiRole.email);
    const update = await peer.request.post(path, {
      headers,
      form: {
        ...original,
        description: "Descripción guardada por otro admin",
        instructorId: peerInstructor.id,
      },
    });
    expect(update.status()).toBe(200);
    const peerRevision = (await update.json()).revision;
    await form.getByLabel("Descripción").fill("Mi intento anterior");
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === path,
      );
      await form.getByRole("button", { name: "Guardar cambios" }).click();
      expect((await response).status()).toBe(409);
      await expect(form.getByLabel("Descripción")).toHaveValue(
        "Mi intento anterior",
      );
      await expect(
        form.getByRole("combobox", { name: "Instructor", exact: true }),
      ).toHaveValue(initialInstructor.id);
      await expect(form.locator('input[name="revision"]')).toHaveValue(
        rejectedRevision,
      );
      await expect(
        page.getByRole("link", { name: "Cargar valores actuales" }),
      ).toBeVisible();
    }
    await page.locator('[data-confirm-fallback="publish"] summary').click();
    const publication = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === path,
    );
    await page.getByRole("button", { name: "Publicar curso" }).click();
    expect((await publication).status()).toBe(409);
    const peerPage = await peer.newPage();
    await peerPage.goto(path);
    await expect(peerPage.getByLabel("Descripción")).toHaveValue(
      "Descripción guardada por otro admin",
    );
    await expect(
      peerPage.getByRole("combobox", { name: "Instructor", exact: true }),
    ).toHaveValue(peerInstructor.id);
    await expect(peerPage.locator("[data-course-status]")).toHaveText(
      "Borrador",
    );
    await page.getByRole("link", { name: "Cargar valores actuales" }).click();
    await expect(form.getByLabel("Descripción")).toHaveValue(
      "Descripción guardada por otro admin",
    );
    await expect(
      form.getByRole("combobox", { name: "Instructor", exact: true }),
    ).toHaveValue(peerInstructor.id);
    await expect(form.locator('input[name="revision"]')).toHaveValue(
      peerRevision,
    );
    await expect(
      page.getByRole("link", { name: "Cargar valores actuales" }),
    ).toHaveCount(0);
  } finally {
    await peer.close();
  }
});

test("new courses preserve values and can be corrected after server validation without JavaScript", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const instructor = await registerCourseInstructor(page);
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
    "instructorId",
    "startDate",
    "endDate",
    "registrationStartDate",
    "registrationEndDate",
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
  await course.locator('select[name="level"]').selectOption("INTERMEDIATE");
  await course
    .getByLabel("Formato de curso")
    .selectOption({ label: formatName });
  await course.getByLabel("Condiciones").fill("Sujeto a confirmación de cupo.");
  await course
    .getByLabel("Contenido del curso (Markdown, opcional)")
    .fill("## Temario visible sin JavaScript");
  await course
    .getByLabel("Fecha de inicio de clases (Bolivia)", { exact: true })
    .fill("2027-03-01");
  await course
    .getByLabel("Fecha de finalización (Bolivia)", { exact: true })
    .fill("2027-03-22");
  await course
    .getByLabel("Apertura de preinscripción (Bolivia)")
    .fill("2027-01-01");
  await course
    .getByLabel("Último día de preinscripción (Bolivia)")
    .fill("2027-02-20");
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
  const markdown = course.getByLabel(
    "Contenido del curso (Markdown, opcional)",
  );
  await expect(markdown).toBeVisible();
  await expect(markdown).toHaveValue("## Temario visible sin JavaScript");
  await expect(course.locator('select[name="level"]')).toHaveValue(
    "INTERMEDIATE",
  );
  await expect(course.getByLabel("Formato de curso")).toHaveValue(
    selectedFormat,
  );
  await expect(
    course.getByLabel("Fecha de inicio de clases (Bolivia)", { exact: true }),
  ).toHaveValue("2027-03-01");
  await expect(
    course.getByLabel("Fecha de finalización (Bolivia)", { exact: true }),
  ).toHaveValue("2027-03-22");
  await expect(course.locator('[name="schedule"]')).toHaveValue(
    "Lunes a viernes · horario por grupo",
  );
  await expect(course.getByLabel("Nota mínima (0–100)")).toHaveValue("101");
  await expect(course.locator('[name="registrationStartDate"]')).toHaveValue(
    "2027-01-01",
  );
  await expect(course.locator('[name="registrationEndDate"]')).toHaveValue(
    "2027-02-20",
  );

  await course.getByLabel("Nota mínima (0–100)").fill("70");
  await course.getByRole("button", { name: "Crear borrador" }).click();
  await expect(page).toHaveURL(
    /\/app\/cursos\/[0-9a-f-]+\/editar\?success=created/,
  );
  await expect(page.getByLabel("Nombre")).toHaveValue(courseName);
  await expect(markdown).toBeVisible();
  await expect(markdown).toHaveValue("## Temario visible sin JavaScript");
  await page
    .getByRole("combobox", { name: "Instructor", exact: true })
    .selectOption(instructor.id);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page).toHaveURL(/success=updated/);
  const prerequisite = await page.request.post(
    new URL(page.url()).pathname.replace(/\/editar$/u, "/grupos"),
    {
      headers: { Origin: e2eSiteUrl(), Accept: "application/json" },
      form: { intent: "create", startTime: "08:00", capacity: "10" },
    },
  );
  expect(prerequisite.status()).toBe(200);
  await page.locator('[data-confirm-fallback="publish"] summary').click();
  await expect(
    page.getByRole("button", { name: "Publicar curso" }),
  ).toBeVisible();
  await page.locator('[data-confirm-fallback="publish"] summary').click();
  await expect(
    page.getByRole("button", { name: "Publicar curso" }),
  ).not.toBeVisible();
  await page.locator('[data-confirm-fallback="publish"] summary').click();
  await page.getByRole("button", { name: "Publicar curso" }).click();
  await expect(page).toHaveURL(/success=published/);
  await page.locator('[data-confirm-fallback="withdraw"] summary').click();
  await page.getByRole("button", { name: "Retirar curso" }).click();
  await expect(page).toHaveURL(/success=withdrawn/);
  await page.locator('[data-confirm-fallback="archive"] summary').click();
  await page.getByRole("button", { name: "Archivar curso" }).click();
  await expect(page).toHaveURL(/success=archived/);
  await expect(page.getByLabel("Nombre")).toBeDisabled();
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
    headers: { Origin: e2eSiteUrl() },
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
    headers: { Origin: e2eSiteUrl(), Accept: "application/json" },
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
    .getByRole("link", { name: "Volver" })
    .click();
  await expect(page).toHaveURL(path);
  await page.locator("[data-action-fallback] summary").click();
  await expect(
    page.getByRole("button", { name: "Eliminar formato" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Eliminar formato" }).click();
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
    headers: { Origin: e2eSiteUrl(), Accept: "application/json" },
    form: {
      name: `Curso sin JS ${Date.now()}`,
      requestKey: crypto.randomUUID(),
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
    page.getByRole("button", { name: "Desactivar formato" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Volver" }).click();
  await expect(page.locator("[data-format-status]")).toHaveText("Activo");
  await page.locator("[data-action-fallback] summary").click();
  await page.getByRole("button", { name: "Desactivar formato" }).click();
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
  const headers = { Origin: e2eSiteUrl() };
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
