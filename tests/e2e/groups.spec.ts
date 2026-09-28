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

test("admin creates and edits groups in place, validates conflicts, and deletes an unpublished group", async ({
  page,
  context,
}) => {
  const { edit, path } = await publishedCourse(page, context);
  await page.request.post(edit, { headers, form: { intent: "withdraw" } });
  await page.goto(path);
  await page.evaluate(() => {
    (window as Window & { groupMarker?: number }).groupMarker = 1;
  });
  await expect(page.getByRole("button", { name: "Nuevo grupo" })).toBeVisible();
  await expect(page.getByRole("form", { name: "Nuevo grupo" })).toBeHidden();
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo grupo" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Hora de inicio").fill("08:00");
  await dialog.getByLabel("Capacidad").fill("15");
  await dialog.getByRole("button", { name: "Crear grupo" }).click();
  const group = page.locator("[data-group-id]").first();
  await expect(group).toContainText("08:00–09:30");
  await expect(group).toContainText("15");
  expect(
    await page.evaluate(
      () => (window as Window & { groupMarker?: number }).groupMarker,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  await dialog.getByLabel("Hora de inicio").fill("09:00");
  await expect(dialog.locator("[data-group-end]")).toContainText("se solapa");
  await dialog.getByLabel("Capacidad").fill("7");
  await dialog.getByRole("button", { name: "Crear grupo" }).click();
  await expect(dialog.locator("#dialog-time-error")).toContainText(
    "Otro grupo del curso ocupa ese horario",
  );
  await expect(dialog.getByLabel("Hora de inicio")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Nuevo grupo" })).toBeFocused();
  await group
    .getByRole("button", { name: "Editar capacidad del grupo 1" })
    .click();
  const capacity = group.getByRole("form", {
    name: "Cambiar capacidad del grupo 1",
  });
  await capacity.getByLabel("Capacidad").fill("20");
  await capacity.getByRole("button", { name: "Cancelar" }).click();
  await expect(group).toContainText("15");
  await group
    .getByRole("button", { name: "Editar capacidad del grupo 1" })
    .click();
  await capacity.getByLabel("Capacidad").fill("20");
  await capacity.getByRole("button", { name: "Guardar" }).click();
  await expect(group).toContainText("20");
  await group
    .getByRole("button", { name: "Editar horario del grupo 1" })
    .click();
  const schedule = group.getByRole("form", {
    name: "Cambiar horario del grupo 1",
  });
  await schedule.getByLabel("Hora de inicio").fill("07:30");
  await schedule.getByRole("button", { name: "Guardar" }).click();
  await expect(group).toContainText("07:30–09:00");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await group.getByRole("button", { name: "Eliminar grupo 1" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("No se puede deshacer");
  await page.keyboard.press("Escape");
  await expect(
    group.getByRole("button", { name: "Eliminar grupo 1" }),
  ).toBeFocused();
  await group.getByRole("button", { name: "Eliminar grupo 1" }).click();
  await confirm.getByRole("button", { name: "Sí, eliminar grupo" }).click();
  await expect(page.locator("[data-group-id]")).toHaveCount(0);
});

test("published groups retain history when deactivated and can reactivate", async ({
  page,
  context,
}) => {
  const { path } = await publishedCourse(page, context);
  const first = await page.request.post(path, {
    headers,
    form: { intent: "create", startTime: "08:00", capacity: "10" },
  });
  expect(first.status()).toBe(200);
  await page.goto(path);
  const group = page.locator("[data-group-id]").first();
  await expect(
    group.getByRole("button", { name: "Eliminar grupo 1" }),
  ).toHaveCount(0);
  await group.getByRole("button", { name: "Desactivar grupo 1" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Sí, desactivar grupo" })
    .click();
  await expect(group).toContainText("Inactivo");
  await group.getByRole("button", { name: "Reactivar grupo 1" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Sí, reactivar grupo" })
    .click();
  await expect(group).toContainText("Planificado");
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
