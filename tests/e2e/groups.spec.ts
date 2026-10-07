import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { e2eSiteUrl } from "../../scripts/e2e-port";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";
import { registerCourseInstructor } from "./instructor-helper";

const origin = e2eSiteUrl();
const headers = { Origin: origin, Accept: "application/json" };

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function courseFixture(
  page: Page,
  context: BrowserContext,
  published = true,
  assigned = true,
) {
  const instructor = await registerCourseInstructor(page);
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
      instructorId: assigned ? instructor.id : "",
      schedule: "Lunes a viernes, 08:00–09:30",
      conditions: "Cupos limitados.",
      requestKey: crypto.randomUUID(),
      startsAt: "2027-03-01T08:00",
      endsAt: "2027-03-17T09:30",
      weekdays: "1,2,3,4,5",
      minimumGrade: "70",
    },
  });
  expect(created.status()).toBe(201);
  const { id, revision } = (await created.json()) as {
    id: string;
    revision: string;
  };
  const edit = `/app/cursos/${id}/editar`;
  if (!published) return { edit, path: `/app/cursos/${id}/grupos` };
  const prerequisite = await page.request.post(`/app/cursos/${id}/grupos`, {
    headers,
    form: { intent: "create", startTime: "20:00", capacity: "1" },
  });
  expect(prerequisite.status()).toBe(200);
  const publication = await page.request.post(edit, {
    headers,
    form: { intent: "publish", revision },
  });
  expect(publication.status()).toBe(200);
  return { edit, path: `/app/cursos/${id}/grupos` };
}

test("initially unassigned draft edits preserve one null value and keep the disabled placeholder", async ({
  page,
  context,
}) => {
  const { edit } = await courseFixture(page, context, false, false);
  await page.goto(edit);
  const instructor = page.getByRole("combobox", {
    name: "Instructor",
    exact: true,
  });
  await expect(instructor).toHaveAttribute("id", "instructorId-select");
  await instructor.click();
  await expect(
    page.getByRole("option", {
      name: "Sin asignar (solo borrador)",
      exact: true,
    }),
  ).toHaveAttribute("data-disabled", "");
  await page.keyboard.press("Escape");
  expect(
    await page
      .locator(".course-form")
      .evaluate((form) =>
        new FormData(form as HTMLFormElement).getAll("instructorId"),
      ),
  ).toEqual(["unassigned"]);
  await page
    .getByLabel("Descripción")
    .fill("Metadata edited without assigning an instructor.");
  await expect(
    page.getByRole("button", { name: "Guardar cambios", exact: true }),
  ).toBeEnabled();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === edit,
  );
  await page
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(page.getByLabel("Descripción")).toHaveValue(
    "Metadata edited without assigning an instructor.",
  );
  await expect(instructor).toContainText("Sin asignar (solo borrador)");
  await expect(
    page.getByRole("button", { name: "Guardar cambios", exact: true }),
  ).toBeDisabled();
});

test("publication without an assigned instructor shows its actual cause inline and in the toast", async ({
  page,
  context,
}) => {
  const { edit } = await courseFixture(page, context, false, false);
  await page.goto(edit);
  await page
    .getByRole("button", { name: "Publicar curso", exact: true })
    .click();
  const result = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === edit,
  );
  await page
    .getByRole("dialog", { name: "Publicar curso" })
    .getByRole("button", { name: "Confirmar publicación" })
    .click();
  expect((await result).status()).toBe(422);
  await expect(page.locator("[data-save-error]")).toContainText(
    "Selecciona un instructor activo registrado.",
  );
  await expect(
    page
      .locator("[data-sileo-toast]")
      .filter({ hasText: "Selecciona un instructor activo registrado." }),
  ).toBeVisible();
});

test("last planned group cannot be cancelled while published; withdrawing preserves the cancellation flow", async ({
  page,
  context,
}) => {
  const { edit, path } = await courseFixture(page, context);
  await page.goto(path);
  const group = page.locator("[data-group-id]").first();
  await group.getByRole("button", { name: "Desactivar grupo 1" }).click();
  const result = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === path,
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Sí, desactivar grupo" })
    .click();
  expect((await result).status()).toBe(409);
  await expect(page.locator("[data-group-error]")).toContainText(
    "último grupo de un curso publicado",
  );
  await expect(
    group.getByRole("button", { name: "Desactivar grupo 1" }),
  ).toBeVisible();
  await page.goto(edit);
  const withdrawn = await page.request.post(edit, {
    headers,
    form: {
      intent: "withdraw",
      revision: await page
        .locator('.course-form input[name="revision"]')
        .inputValue(),
    },
  });
  expect(withdrawn.status()).toBe(200);
  await page.goto(path);
  await group.getByRole("button", { name: "Desactivar grupo 1" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Sí, desactivar grupo" })
    .click();
  await expect(group.getByText("Inactivo", { exact: true })).toBeVisible();
});

test("admin creates and edits groups in place, validates conflicts, and deletes an unpublished group", async ({
  page,
  context,
}) => {
  const { edit, path } = await courseFixture(page, context, false);
  await page.goto(edit);
  await page.getByRole("link", { name: "Grupos", exact: true }).click();
  await expect(page).toHaveURL(path);
  let groupPageGets = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === path)
      groupPageGets++;
  });
  await page.evaluate(() => {
    (window as Window & { groupMarker?: number }).groupMarker = 1;
  });
  await expect(page.getByRole("button", { name: "Nuevo grupo" })).toBeVisible();
  await expect(page.locator("header [data-new-trigger]")).toBeVisible();
  await expect(page.getByRole("form", { name: "Nuevo grupo" })).toBeHidden();
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo grupo" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Hora de inicio").fill("08:00");
  await dialog.getByLabel("Capacidad").fill("15");
  await dialog.getByRole("button", { name: "Crear grupo" }).click();
  const group = page.locator("[data-group-id]").first();
  await expect(group).toContainText("08:00–09:30");
  await expect(group).not.toContainText("Planificado");
  await expect(group).toContainText("15");
  const groupNode = await group.elementHandle();
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
  const capacityTrigger = group.locator(
    '[data-group-field="capacity"] summary',
  );
  const scheduleTrigger = group.locator(
    '[data-group-field="schedule"] summary',
  );
  await expect(capacityTrigger).toHaveAttribute(
    "aria-label",
    "Editar capacidad del grupo 1",
  );
  await expect(capacityTrigger.locator("svg")).toBeVisible();
  await expect(capacityTrigger).not.toContainText("Editar capacidad");
  await capacityTrigger.click();
  const capacity = group.getByRole("form", {
    name: "Cambiar capacidad del grupo 1",
  });
  await expect(capacity).toBeVisible();
  await expect(group.getByText("15", { exact: true })).toBeHidden();
  await capacity.getByLabel("Nueva capacidad").fill("20");
  await capacity.getByRole("button", { name: /Cancelar edición/ }).click();
  await expect(group.getByText("15", { exact: true })).toBeVisible();
  await expect(capacityTrigger).toBeFocused();
  await capacityTrigger.click();
  await capacity.getByLabel("Nueva capacidad").fill("20");
  await capacity
    .getByRole("button", { name: "Guardar capacidad del grupo 1" })
    .click();
  await expect(group).toContainText("20");
  await scheduleTrigger.click();
  const schedule = group.getByRole("form", {
    name: "Cambiar horario del grupo 1",
  });
  await schedule.getByLabel("Hora de inicio").fill("07:30");
  await expect(group.getByText("08:00–09:30", { exact: true })).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await schedule
      .getByLabel("Hora de inicio")
      .evaluate((input) => input.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(90);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 768, height: 900 });
  expect(
    await schedule
      .getByLabel("Hora de inicio")
      .evaluate((input) => input.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(90);
  await schedule
    .getByRole("button", { name: "Guardar horario del grupo 1" })
    .click();
  await expect(group).toContainText("07:30–09:00");
  expect(await groupNode!.evaluate((node) => node.isConnected)).toBe(true);
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
  expect(groupPageGets).toBe(0);
});

test("published groups retain history when deactivated and can reactivate", async ({
  page,
  context,
}) => {
  const { path } = await courseFixture(page, context);
  const first = await page.request.post(path, {
    headers,
    form: { intent: "create", startTime: "08:00", capacity: "10" },
  });
  expect(first.status()).toBe(200);
  await page.goto(path);
  const group = page.locator("[data-group-id]").nth(1);
  await expect(
    group.getByRole("button", { name: "Eliminar grupo 2" }),
  ).toHaveCount(0);
  await group.getByRole("button", { name: "Desactivar grupo 2" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Sí, desactivar grupo" })
    .click();
  await expect(group).toContainText("Inactivo");
  await group.getByRole("button", { name: "Reactivar grupo 2" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Sí, reactivar grupo" })
    .click();
  await expect(group).not.toContainText("Planificado");
  await expect(group).not.toContainText("Inactivo");
});
test("groups are admin-only, validate origin, course and revision, and fit mobile", async ({
  page,
  context,
}) => {
  const { path } = await courseFixture(page, context);
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

test("confirmation closes while pending; failure and retry preserve other cards without a page GET", async ({
  page,
  context,
}) => {
  const { path } = await courseFixture(page, context);
  for (const startTime of ["08:00", "10:00"]) {
    const response = await page.request.post(path, {
      headers,
      form: { intent: "create", startTime, capacity: "10" },
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto(path);
  const first = page.locator("[data-group-id]").nth(1);
  const second = page.locator("[data-group-id]").nth(2);
  const firstNode = await first.elementHandle();
  const otherNode = await second.elementHandle();
  await second.getByLabel("Editar capacidad del grupo 3").click();
  const otherInput = second.getByLabel("Nueva capacidad");
  await otherInput.fill("17");
  let getCount = 0;
  let postCount = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === path && request.method() === "GET")
      getCount++;
  });
  let release = () => {};
  let fail = true;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    postCount++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Fallo temporal de grupos." }),
      });
    else await route.continue();
  });
  await first.getByRole("button", { name: "Desactivar grupo 2" }).click();
  const confirmation = page.getByRole("alertdialog");
  await confirmation
    .getByRole("button", { name: "Sí, desactivar grupo" })
    .click();
  await expect.poll(() => postCount).toBe(1);
  await expect(confirmation).toBeHidden();
  await expect(first).toHaveAttribute("aria-busy", "true");
  await expect(first).not.toContainText("Inactivo");
  await expect(
    page.getByText("Guardando grupo…", { exact: true }),
  ).toBeVisible();
  // Programmatic repeated submission cannot bypass the synchronous entity lock.
  await page
    .locator("[data-action-dialog] form")
    .evaluate((form: HTMLFormElement) => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  expect(postCount).toBe(1);
  release();
  await expect(page.locator("[data-group-error]")).toContainText(
    "Fallo temporal de grupos.",
  );
  await expect(first).not.toHaveAttribute("aria-busy", "true");
  await expect(otherInput).toHaveValue("17");
  expect(await otherNode!.evaluate((node) => node.isConnected)).toBe(true);
  fail = false;
  await first.getByRole("button", { name: "Desactivar grupo 2" }).click();
  await confirmation
    .getByRole("button", { name: "Sí, desactivar grupo" })
    .click();
  await expect.poll(() => postCount).toBe(2);
  await expect(confirmation).toBeHidden();
  release();
  await expect(first).toContainText("Inactivo");
  await expect(otherInput).toHaveValue("17");
  expect(await firstNode!.evaluate((node) => node.isConnected)).toBe(true);
  expect(await otherNode!.evaluate((node) => node.isConnected)).toBe(true);
  expect(getCount).toBe(0);
});

test("stale revision is recovered with an authorized JSON read, preserving an unrelated edit", async ({
  page,
  context,
}) => {
  const { path } = await courseFixture(page, context);
  const firstResponse = await page.request.post(path, {
    headers,
    form: { intent: "create", startTime: "08:00", capacity: "10" },
  });
  const firstDto = (await firstResponse.json()) as {
    id: string;
    revision: string;
  };
  await page.request.post(path, {
    headers,
    form: { intent: "create", startTime: "10:00", capacity: "10" },
  });
  await page.goto(path);
  const first = page.locator("[data-group-id]").nth(1);
  const second = page.locator("[data-group-id]").nth(2);
  const otherNode = await second.elementHandle();
  await second.getByLabel("Editar capacidad del grupo 3").click();
  await second.getByLabel("Nueva capacidad").fill("19");
  const concurrent = await page.request.post(path, {
    headers,
    form: {
      intent: "capacity",
      groupId: firstDto.id,
      revision: firstDto.revision,
      capacity: "12",
    },
  });
  expect(concurrent.ok()).toBe(true);
  await first.getByLabel("Editar capacidad del grupo 2").click();
  await first.getByLabel("Nueva capacidad").fill("15");
  await first.getByLabel("Guardar capacidad del grupo 2").click();
  await expect(page.locator("[data-group-error]")).toBeVisible();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === path)
      requests.push(request.headers().accept ?? "");
  });
  await page.getByRole("button", { name: "Consultar datos actuales" }).click();
  await expect(page.locator("[data-group-error]")).toBeHidden();
  await expect(
    first.locator('[data-group-field="capacity"] dd > span'),
  ).toHaveText("12");
  await expect(first.getByLabel("Nueva capacidad")).toHaveValue("15");
  await first
    .getByRole("button", {
      name: "Cancelar edición de capacidad del grupo 2",
      exact: true,
    })
    .click();
  await first.getByLabel("Editar capacidad del grupo 2").click();
  await expect(first.getByLabel("Nueva capacidad")).toHaveValue("12");
  await first.getByLabel("Nueva capacidad").fill("15");
  await first.getByLabel("Guardar capacidad del grupo 2").click();
  await expect(
    first.locator('[data-group-field="capacity"] dd > span'),
  ).toHaveText("15");
  await expect(second.getByLabel("Nueva capacidad")).toHaveValue("19");
  expect(await otherNode!.evaluate((node) => node.isConnected)).toBe(true);
  expect(requests).toEqual(["application/json"]);
});

test("recovery locks only its entity and keeps a sibling's newer schedule after a delayed GET", async ({
  page,
  context,
}) => {
  const { path } = await courseFixture(page, context);
  const created = await page.request.post(path, {
    headers,
    form: { intent: "create", startTime: "08:00", capacity: "10" },
  });
  const dto = (await created.json()) as { id: string; revision: string };
  await page.request.post(path, {
    headers,
    form: { intent: "create", startTime: "10:00", capacity: "10" },
  });
  await page.goto(path);
  const first = page.locator("[data-group-id]").nth(1);
  const second = page.locator("[data-group-id]").nth(2);
  await page.request.post(path, {
    headers,
    form: {
      intent: "capacity",
      groupId: dto.id,
      revision: dto.revision,
      capacity: "12",
    },
  });
  await first.getByLabel("Editar capacidad del grupo 2").click();
  await first.getByLabel("Nueva capacidad").fill("15");
  await first.getByLabel("Guardar capacidad del grupo 2").click();
  await expect(page.locator("[data-group-error]")).toBeVisible();
  const snapshot = deferred();
  const resume = deferred();
  let posts = 0;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      return route.continue();
    }
    const response = await route.fetch();
    snapshot.release();
    await resume.promise;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Consultar datos actuales" }).click();
  await snapshot.promise;
  await expect(first).toHaveAttribute("aria-busy", "true");
  await expect(
    first.getByLabel("Guardar capacidad del grupo 2"),
  ).toBeDisabled();
  await expect(
    first.getByRole("button", { name: "Desactivar grupo 2" }),
  ).toBeDisabled();
  await first
    .getByRole("form", { name: "Cambiar capacidad del grupo 2" })
    .evaluate((form: HTMLFormElement) =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
  await second.getByLabel("Editar horario del grupo 3").click();
  await second.getByLabel("Hora de inicio").fill("12:00");
  await second.getByLabel("Guardar horario del grupo 3").click();
  await expect(second).toContainText("12:00–13:30");
  expect(posts).toBe(1);
  resume.release();
  await expect(page.locator("[data-group-error]")).toBeHidden();
  await expect(first.getByLabel("Guardar capacidad del grupo 2")).toBeEnabled();
  await expect(first.getByLabel("Nueva capacidad")).toHaveValue("15");
  await first
    .getByRole("button", {
      name: "Cancelar edición de capacidad del grupo 2",
      exact: true,
    })
    .click();
  await first.getByLabel("Editar capacidad del grupo 2").click();
  await expect(first.getByLabel("Nueva capacidad")).toHaveValue("12");
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo grupo" });
  await dialog.getByLabel("Hora de inicio").fill("12:00");
  await expect(dialog.locator("[data-group-end]")).toContainText("se solapa");
  await dialog.getByLabel("Hora de inicio").fill("10:00");
  await expect(dialog.locator("[data-group-end]")).not.toContainText(
    "se solapa",
  );
});

test("a delayed create-recovery snapshot cannot resurrect a sibling deleted after the GET", async ({
  page,
  context,
}) => {
  const { path } = await courseFixture(page, context, false);
  await page.request.post(path, {
    headers,
    form: { intent: "create", startTime: "08:00", capacity: "10" },
  });
  await page.goto(path);
  const snapshot = deferred();
  const resume = deferred();
  let rejectedCreate = false;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === "POST") {
      if (!rejectedCreate) {
        rejectedCreate = true;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Alta temporalmente no disponible.",
          }),
        });
      }
      return route.continue();
    }
    const response = await route.fetch();
    snapshot.release();
    await resume.promise;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo grupo" });
  await dialog.getByLabel("Hora de inicio").fill("10:00");
  await dialog.getByLabel("Capacidad").fill("15");
  await dialog.getByRole("button", { name: "Crear grupo" }).click();
  await expect(page.locator("[data-group-error]")).toContainText(
    "Alta temporalmente no disponible.",
  );
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Consultar datos actuales" }).click();
  await snapshot.promise;
  await expect(
    page.getByRole("button", { name: "Nuevo grupo" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Eliminar grupo 1" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Sí, eliminar grupo" })
    .click();
  await expect(page.locator("[data-group-id]")).toHaveCount(0);
  resume.release();
  await expect(page.locator("[data-group-error]")).toBeHidden();
  await expect(page.locator("[data-group-id]")).toHaveCount(0);
  await expect(
    page.getByText("Todavía no hay grupos.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Nuevo grupo" })).toBeEnabled();
});

test("two groups can confirm concurrently through the shared dialog", async ({
  page,
  context,
}) => {
  const { path } = await courseFixture(page, context);
  for (const startTime of ["08:00", "10:00"])
    await page.request.post(path, {
      headers,
      form: { intent: "create", startTime, capacity: "10" },
    });
  await page.goto(path);
  const gates: ReturnType<typeof deferred>[] = [];
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const gate = deferred();
    gates.push(gate);
    await gate.promise;
    await route.continue();
  });
  const first = page.locator("[data-group-id]").nth(1);
  const second = page.locator("[data-group-id]").nth(2);
  const dialog = page.getByRole("alertdialog");
  await first.getByRole("button", { name: "Desactivar grupo 2" }).click();
  await dialog.getByRole("button", { name: "Sí, desactivar grupo" }).click();
  await expect.poll(() => gates.length).toBe(1);
  await expect(dialog).toBeHidden();
  await expect(
    first.getByRole("button", { name: "Desactivar grupo 2" }),
  ).toBeDisabled();
  await second.getByRole("button", { name: "Desactivar grupo 3" }).click();
  await expect(
    dialog.getByRole("button", { name: "Sí, desactivar grupo" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Sí, desactivar grupo" }).click();
  await expect.poll(() => gates.length).toBe(2);
  await expect(dialog).toBeHidden();
  gates[1]!.release();
  await expect(second).toContainText("Inactivo");
  await expect(first).toHaveAttribute("aria-busy", "true");
  await expect(first).not.toContainText("Inactivo");
  gates[0]!.release();
  await expect(first).toContainText("Inactivo");
  await expect(
    second.getByRole("button", { name: "Reactivar grupo 3" }),
  ).toBeEnabled();
});

test("pending saves freeze only submitted inputs and validation restores field focus without losing drafts", async ({
  page,
  context,
}) => {
  const { path } = await courseFixture(page, context);
  for (const startTime of ["08:00", "10:00"])
    await page.request.post(path, {
      headers,
      form: { intent: "create", startTime, capacity: "10" },
    });
  await page.goto(path);
  const first = page.locator("[data-group-id]").nth(1);
  const second = page.locator("[data-group-id]").nth(2);
  await second.getByLabel("Editar capacidad del grupo 3").click();
  await second.getByLabel("Nueva capacidad").fill("19");
  const gates: ReturnType<typeof deferred>[] = [];
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const gate = deferred();
    gates.push(gate);
    await gate.promise;
    await route.continue();
  });
  await first.getByLabel("Editar horario del grupo 2").click();
  const time = first.getByLabel("Hora de inicio");
  await time.fill("10:00");
  await first.getByLabel("Guardar horario del grupo 2").click();
  await expect.poll(() => gates.length).toBe(1);
  await expect(time).toBeDisabled();
  await expect(second.getByLabel("Nueva capacidad")).toBeEnabled();
  gates[0]!.release();
  await expect(time).toHaveAttribute("aria-invalid", "true");
  await expect(time).toBeEnabled();
  await expect(time).toBeFocused();
  await expect(page.locator("[data-group-error]")).toBeVisible();
  await expect(second.getByLabel("Nueva capacidad")).toHaveValue("19");
  await first
    .getByRole("button", {
      name: "Cancelar edición de horario del grupo 2",
      exact: true,
    })
    .click();
  await first.getByLabel("Editar capacidad del grupo 2").click();
  const capacity = first.getByLabel("Nueva capacidad");
  await capacity.fill("12");
  await first.getByLabel("Guardar capacidad del grupo 2").click();
  await expect.poll(() => gates.length).toBe(2);
  await expect(capacity).toBeDisabled();
  await expect(second.getByLabel("Nueva capacidad")).toBeEnabled();
  gates[1]!.release();
  await expect(
    first.locator('[data-group-field="capacity"] dd > span'),
  ).toHaveText("12");
  await first.getByLabel("Editar capacidad del grupo 2").click();
  await expect(capacity).toHaveValue("12");
  await expect(capacity).toBeEnabled();
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo grupo" });
  const newTime = dialog.getByLabel("Hora de inicio");
  const newCapacity = dialog.getByLabel("Capacidad");
  await newTime.fill("10:00");
  await newCapacity.fill("15");
  await dialog.getByRole("button", { name: "Crear grupo" }).click();
  await expect.poll(() => gates.length).toBe(3);
  await expect(newTime).toBeDisabled();
  await expect(newCapacity).toBeDisabled();
  gates[2]!.release();
  await expect(newTime).toHaveAttribute("aria-invalid", "true");
  await expect(newTime).toBeEnabled();
  await expect(newCapacity).toBeEnabled();
  await expect(newTime).toBeFocused();
  await expect(newTime).toHaveValue("10:00");
  await expect(newCapacity).toHaveValue("15");
});
