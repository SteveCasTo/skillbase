import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

const origin = "http://127.0.0.1:4321";
const headers = { Origin: origin, Accept: "application/json" };

async function publishedCourse(page: Page, context: BrowserContext) {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const format = await page.request.post("/app/formatos/nuevo", {
    headers,
    form: {
      name: `Formato grupo ${Date.now()}`,
      totalHours: "20",
      sessionMinutes: "90",
      studentAmount: "80",
      externalAmount: "100",
    },
  });
  expect(format.status()).toBe(201);
  const { id: courseTypeId } = (await format.json()) as { id: string };
  const created = await page.request.post("/app/cursos/nuevo", {
    headers,
    form: {
      name: `Curso grupo ${Date.now()}`,
      description: "Curso para gestión de grupos.",
      level: "BASIC",
      courseTypeId,
      schedule: "Lunes a viernes, 08:00–09:30",
      conditions: "Cupos limitados.",
      startsAt: "2027-03-01T08:00",
      endsAt: "2027-03-17T09:30",
      weekdays: "1,2,3,4,5",
      minimumGrade: "70",
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const edit = `/app/cursos/${id}/editar`;
  const published = await page.request.post(edit, {
    headers,
    form: { intent: "publish" },
  });
  expect(published.status()).toBe(200);
  return { edit, path: `/app/cursos/${id}/grupos` };
}

test("admin manages group hours, capacity and cancellation without a document reload", async ({
  page,
  context,
}) => {
  const { edit, path } = await publishedCourse(page, context);
  await page.goto(edit);
  await page.getByRole("link", { name: "Grupos" }).click();
  await expect(page).toHaveURL(path);
  await expect(
    page
      .getByRole("navigation", { name: "Secciones del curso" })
      .getByRole("link", { name: "Grupos" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page
      .getByRole("navigation", { name: "Ruta de navegación" })
      .getByText("Grupos"),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/1 de marzo de 2027/)).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { groupMarker?: number }).groupMarker = 1;
  });
  const create = page.getByRole("form", { name: "Añadir grupo" });
  await create.getByLabel("Hora de inicio").fill("08:00");
  await expect(create.locator("[data-group-end]")).toContainText(
    "Fin calculado: 09:30",
  );
  await create.getByLabel("Capacidad").fill("15");
  await create.getByRole("button", { name: "Crear grupo" }).click();
  await expect(page.getByText("08:00–09:30 · Capacidad: 15")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { groupMarker?: number }).groupMarker,
    ),
  ).toBe(1);
  const conflict = await page.request.post(path, {
    headers,
    form: { intent: "create", startTime: "09:00", capacity: "10" },
  });
  expect(conflict.status()).toBe(409);
  await expect(page.getByText("08:00–09:30 · Capacidad: 15")).toBeVisible();
  await create.getByLabel("Hora de inicio").fill("09:00");
  await expect(create.locator("[data-group-end]")).toContainText("se solapa");
  await create.getByLabel("Capacidad").fill("7");
  await create.getByRole("button", { name: "Crear grupo" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Otro grupo del curso ocupa ese horario",
  );
  const conflictingTime = create.getByLabel("Hora de inicio");
  await expect(conflictingTime).toHaveAttribute("aria-invalid", "true");
  await expect(conflictingTime).toHaveAttribute(
    "aria-describedby",
    "new-time-error",
  );
  await expect(page.locator("#new-time-error")).toContainText(
    "Otro grupo del curso ocupa ese horario",
  );
  await expect(create.getByLabel("Hora de inicio")).toHaveValue("09:00");
  await expect(create.getByLabel("Capacidad")).toHaveValue("7");
  const adjacent = await page.request.post(path, {
    headers,
    form: { intent: "create", startTime: "09:30", capacity: "10" },
  });
  expect(adjacent.status()).toBe(200);
  const capacityForm = page.getByRole("form", {
    name: "Cambiar capacidad del grupo 1",
  });
  const staleRevision = await capacityForm
    .locator('[name="revision"]')
    .inputValue();
  await capacityForm.getByLabel("Nueva capacidad").fill("20");
  await capacityForm.getByRole("button", { name: "Guardar capacidad" }).click();
  await expect(page.getByText("08:00–09:30 · Capacidad: 20")).toBeVisible();
  const groupId = await page
    .locator("[data-group-id]")
    .first()
    .getAttribute("data-group-id");
  const stale = await page.request.post(path, {
    headers,
    form: {
      intent: "capacity",
      groupId: groupId!,
      revision: staleRevision,
      capacity: "30",
    },
  });
  expect(stale.status()).toBe(409);
  await capacityForm
    .locator('[name="revision"]')
    .evaluate((input: HTMLInputElement, revision) => {
      input.value = revision;
    }, staleRevision);
  await capacityForm.getByLabel("Nueva capacidad").fill("25");
  await capacityForm.getByRole("button", { name: "Guardar capacidad" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Recargar datos actuales",
  );
  await page.getByRole("button", { name: "Recargar datos actuales" }).click();
  await expect(page.getByText("08:00–09:30 · Capacidad: 20")).toBeVisible();
  await page
    .getByRole("form", { name: "Cambiar horario del grupo 1" })
    .getByLabel("Nueva hora de inicio")
    .fill("07:30");
  await page
    .getByRole("form", { name: "Cambiar horario del grupo 1" })
    .getByRole("button", { name: "Guardar horario" })
    .click();
  await expect(page.getByText("07:30–09:00 · Capacidad: 20")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page
    .locator("[data-group-id]")
    .first()
    .getByRole("button", { name: "Cancelar grupo" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page
      .locator("[data-group-id]")
      .first()
      .getByRole("button", { name: "Cancelar grupo" }),
  ).toBeFocused();
  await page
    .locator("[data-group-id]")
    .first()
    .getByRole("button", { name: "Cancelar grupo" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sí, cancelar grupo" })
    .click();
  await expect(page.locator("[data-group-id]").first()).toContainText(
    "Cancelado",
  );
  await expect(page.getByText("07:30–09:00 · Capacidad: 20")).toBeVisible();
});

test("withdrawn courses allow groups in draft; archive retains cancellation and history", async ({
  page,
  context,
}) => {
  const { edit, path } = await publishedCourse(page, context);
  const requestHeaders = { ...headers, Accept: "application/json" };
  const first = await page.request.post(path, {
    headers: requestHeaders,
    form: { intent: "create", startTime: "08:00", capacity: "10" },
  });
  expect(first.status()).toBe(200);
  const second = await page.request.post(path, {
    headers: requestHeaders,
    form: { intent: "create", startTime: "09:30", capacity: "10" },
  });
  expect(second.status()).toBe(200);

  expect(
    (
      await page.request.post(edit, {
        headers: requestHeaders,
        form: { intent: "withdraw" },
      })
    ).status(),
  ).toBe(200);
  await page.goto(path);
  await expect(page.getByRole("form", { name: "Añadir grupo" })).toHaveCount(1);
  const groups = page.locator("[data-group-id]");
  await expect(
    groups.nth(0).getByRole("button", { name: "Cancelar grupo" }),
  ).toBeVisible();
  await expect(
    groups.nth(0).getByRole("button", { name: "Guardar horario" }),
  ).toBeVisible();
  await groups.nth(0).getByRole("button", { name: "Cancelar grupo" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sí, cancelar grupo" })
    .click();
  await expect(groups.nth(0)).toContainText("Cancelado");
  expect(
    (
      await page.request.post(path, {
        headers: requestHeaders,
        form: { intent: "create", startTime: "11:00", capacity: "10" },
      })
    ).status(),
  ).toBe(200);

  expect(
    (
      await page.request.post(edit, {
        headers: requestHeaders,
        form: { intent: "archive" },
      })
    ).status(),
  ).toBe(200);
  await page.goto(path);
  await groups.nth(1).getByRole("button", { name: "Cancelar grupo" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sí, cancelar grupo" })
    .click();
  await expect(groups.nth(1)).toContainText("Cancelado");
  expect(
    (
      await page.request.post(path, {
        headers: requestHeaders,
        form: {
          intent: "schedule",
          groupId: (await groups.nth(1).getAttribute("data-group-id"))!,
          revision: new Date().toISOString(),
          startTime: "10:00",
        },
      })
    ).status(),
  ).toBe(409);
});

test("groups are admin-only, validate origin, course and revision, and fit mobile", async ({
  page,
  context,
}) => {
  const { path } = await publishedCourse(page, context);
  expect(
    (
      await page.request.post(path, {
        headers: { Accept: "application/json" },
        form: { intent: "create", startTime: "08:00", capacity: "2" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(path, {
        headers,
        form: { intent: "create", startTime: "08:00", capacity: "0" },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await page.request.post(path, {
        headers,
        form: {
          intent: "capacity",
          groupId: "10000000-0000-4000-8000-000000000001",
          revision: new Date().toISOString(),
          capacity: "2",
        },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.post(path, { headers, form: { intent: "unexpected" } })
    ).status(),
  ).toBe(400);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await context.clearCookies();
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto(path);
  await expect(page).toHaveURL(/unauthorized\?reason=forbidden/);
  const denied = await page.request.post(path, {
    headers,
    form: { intent: "create", startTime: "08:00", capacity: "2" },
    maxRedirects: 0,
  });
  expect(denied.status()).toBe(303);
  expect(denied.headers().location).toContain("unauthorized");
});
