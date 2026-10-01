import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

const headers = { Origin: "http://127.0.0.1:4321", Accept: "application/json" };

// Only the isolated E2E server is used. Auth helper obtains the temporary
// environment and signs in through the existing Supabase Admin API.
async function interestCourse(page: Page, context: BrowserContext) {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const name = `Interés sintético ${crypto.randomUUID()}`;
  const format = await page.request.post("/app/formatos/nuevo", {
    headers,
    form: {
      name,
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
      name,
      description: "Curso sintético para interesados.",
      level: "BASIC",
      courseTypeId,
      schedule: "Lunes a viernes, 08:00–09:30",
      conditions: "Solicitud de interés, sin reserva.",
      requestKey: crypto.randomUUID(),
      startsAt: "2040-03-05T08:00",
      endsAt: "2040-03-23T09:30",
      weekdays: "1,2,3,4,5",
      minimumGrade: "70",
    },
  });
  expect(created.status()).toBe(201);
  const { id, revision } = (await created.json()) as {
    id: string;
    revision: string;
  };
  const groupPath = `/app/cursos/${id}/grupos`;
  const groupResponse = await page.request.post(groupPath, {
    headers,
    form: { intent: "create", startTime: "08:00", capacity: "10" },
  });
  expect(groupResponse.status()).toBe(200);
  const group = (await groupResponse.json()) as {
    id: string;
    revision: string;
  };
  const published = await page.request.post(`/app/cursos/${id}/editar`, {
    headers,
    form: { intent: "publish", revision },
  });
  expect(published.status()).toBe(200);
  await page.goto("/cursos");
  const publicPath = await page
    .getByRole("link", { name: new RegExp(name) })
    .getAttribute("href");
  expect(publicPath).toMatch(/^\/cursos\//);
  for (const [firstName, preferredGroupId] of [
    ["Ana Sintética", group.id],
    ["Luis Sintético", ""],
  ]) {
    const result = await page.request.post(publicPath!, {
      headers,
      form: {
        firstName: firstName!,
        lastName: "Fixture",
        email: `${crypto.randomUUID()}@example.test`,
        preferredGroupId: preferredGroupId!,
      },
    });
    expect(result.status()).toBe(200);
    expect(await result.json()).toMatchObject({ ok: true });
  }
  // Historical preference remains active after the group is cancelled.
  const groups = await page.request.get(groupPath, { headers });
  const snapshot = (await groups.json()) as {
    groups: { id: string; revision: string }[];
  };
  const current = snapshot.groups.find((item) => item.id === group.id)!;
  const cancelled = await page.request.post(groupPath, {
    headers,
    form: { intent: "cancel", groupId: group.id, revision: current.revision },
  });
  expect(cancelled.status()).toBe(200);
  return { id, name, path: `/app/interesados/${id}`, groupId: group.id };
}

const rowFor = (page: Page, name = "Ana Sintética") =>
  page.locator("[data-interest-id]").filter({
    has: page.getByRole("heading", { name: `${name} Fixture`, exact: true }),
  });
async function confirmAction(page: Page, row: Locator, action: string) {
  await row.getByText(action, { exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: action });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("public demand reaches ADMIN and cancel/reactivate reconcile locally with row-only pending state", async ({
  page,
  context,
}) => {
  const course = await interestCourse(page, context);
  await page.goto("/app/interesados");
  await expect(
    page.getByRole("link", { name: new RegExp(course.name) }),
  ).toContainText("Interesados activos 2");
  await page.getByRole("link", { name: new RegExp(course.name) }).click();
  await expect(page).toHaveURL(course.path);
  await expect(page.locator("[data-active-total]")).toHaveText("2");
  await expect(
    page
      .getByText("08:00–09:30 · Grupo cancelado (histórico)", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.locator(`[data-preference-id="${course.groupId}"]`),
  ).toHaveText("1");
  await expect(page.locator('[data-preference-id=""]')).toHaveText("1");
  const row = rowFor(page);
  await row.locator("summary").focus();
  await row.locator("summary").press("Enter");
  await expect(
    page.getByRole("alertdialog", { name: "Cancelar interés" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(row.locator("summary")).toBeFocused();
  const originalRow = await row.elementHandle();
  const revision = await row.locator('input[name="revision"]').inputValue();
  await page.evaluate(() => {
    (window as Window & { interestMarker?: number }).interestMarker = 1;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${course.path}`, async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  await confirmAction(page, row, "Cancelar interés");
  await expect(row).toHaveAttribute("aria-busy", "true");
  await expect(row.locator("summary")).toHaveAttribute("aria-disabled", "true");
  await expect(
    rowFor(page, "Luis Sintético").locator("summary"),
  ).not.toHaveAttribute("aria-disabled", "true");
  release();
  await expect(row.locator("[data-interest-status]")).toHaveText("Cancelado");
  await expect(page.locator("[data-active-total]")).toHaveText("1");
  await expect(row.locator('input[name="revision"]')).not.toHaveValue(revision);
  expect(await originalRow?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(row.locator("summary")).toBeFocused();
  await confirmAction(page, row, "Reactivar interés");
  await expect(row.locator("[data-interest-status]")).toHaveText("Activo");
  await expect(page.locator("[data-active-total]")).toHaveText("2");
  expect(
    await page.evaluate(
      () => (window as Window & { interestMarker?: number }).interestMarker,
    ),
  ).toBe(1);
});

test("409 shows current state and revision without replaying the obsolete intent", async ({
  page,
  context,
}) => {
  const course = await interestCourse(page, context);
  await page.goto(course.path);
  const row = rowFor(page);
  const id = await row
    .locator('input[name="interestRegistrationId"]')
    .inputValue();
  const revision = await row.locator('input[name="revision"]').inputValue();
  const concurrent = await page.request.post(course.path, {
    headers,
    form: { intent: "cancel", interestRegistrationId: id, revision },
  });
  expect(concurrent.status()).toBe(200);
  const current = (await concurrent.json()) as {
    registration: { updatedAt: string };
  };
  let posts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === course.path
    )
      posts++;
  });
  await confirmAction(page, row, "Cancelar interés");
  await expect(row.locator("[data-row-error]")).toContainText(
    "El registro cambió",
  );
  await expect(row.locator("[data-interest-status]")).toHaveText("Cancelado");
  await expect(row.locator('input[name="revision"]')).toHaveValue(
    current.registration.updatedAt,
  );
  await expect(page.locator("[data-active-total]")).toHaveText("1");
  expect(posts).toBe(1);
  await confirmAction(page, row, "Reactivar interés");
  await expect(row.locator("[data-interest-status]")).toHaveText("Activo");
  expect(posts).toBe(2);
});

test("status filter removes changed rows, preserves filter and shows local empty state on mobile", async ({
  page,
  context,
}) => {
  const course = await interestCourse(page, context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${course.path}?status=ACTIVE`);
  for (const name of ["Ana Sintética", "Luis Sintético"]) {
    const row = rowFor(page, name);
    await confirmAction(page, row, "Cancelar interés");
    await expect(row).toHaveCount(0);
  }
  await expect(page).toHaveURL(`${course.path}?status=ACTIVE`);
  await expect(
    page.getByRole("link", { name: "Activos", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-interests-empty]")).toBeVisible();
  await expect(page.locator("[data-active-total]")).toHaveText("0");
  await expect(
    page.getByRole("heading", { name: "Registros de interés" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("expired-session redirect is not reported as a successful mutation", async ({
  page,
  context,
}) => {
  const course = await interestCourse(page, context);
  await page.goto(course.path);
  await page.route(`**${course.path}`, async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({ status: 302, headers: { Location: "/login" } });
    else await route.continue();
  });
  const row = rowFor(page);
  await confirmAction(page, row, "Cancelar interés");
  await expect(row.locator("[data-row-error]")).toContainText("sesión");
  await expect(
    page.getByRole("link", { name: "Iniciar sesión", exact: true }),
  ).toBeVisible();
  await expect(row.locator("[data-interest-status]")).toHaveText("Activo");
  await expect(page.locator("[data-active-total]")).toHaveText("2");
});

test("HTML fallback confirms and redirects without JS; errors stay visible", async ({
  browser,
  page,
  context,
}) => {
  const course = await interestCourse(page, context);
  const fallback = await browser.newContext({ javaScriptEnabled: false });
  try {
    await signInFixture(fallback, AUTH_FIXTURES.admin.email);
    const html = await fallback.newPage();
    await html.goto(course.path);
    const row = rowFor(html);
    await row.getByText("Cancelar interés", { exact: true }).click();
    await row.getByRole("button", { name: "Confirmar cancelación" }).click();
    await expect(html).toHaveURL(`${course.path}?success=updated`);
    await expect(rowFor(html).locator("[data-interest-status]")).toHaveText(
      "Cancelado",
    );
    await expect(html.getByRole("status")).toContainText(
      "Estado del interesado actualizado",
    );
    const response = await html.request.post(course.path, {
      headers: { Origin: headers.Origin },
      form: {
        intent: "reactivate",
        interestRegistrationId: await rowFor(html)
          .locator('input[name="interestRegistrationId"]')
          .inputValue(),
        revision: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(response.status()).toBe(409);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.text()).toContain("El registro cambió");
  } finally {
    await fallback.close();
  }
});

test("instructor and disabled identities cannot access interests by direct URL", async ({
  browser,
}) => {
  for (const [email, reason] of [
    [AUTH_FIXTURES.instructor.email, "forbidden"],
    [AUTH_FIXTURES.disabled.email, "disabled"],
  ] as const) {
    const context = await browser.newContext();
    try {
      await signInFixture(context, email);
      const page = await context.newPage();
      for (const path of [
        "/app/interesados",
        "/app/interesados/10000000-0000-4000-8000-000000000001",
      ]) {
        await page.goto(path);
        await expect(page).toHaveURL(`/unauthorized?reason=${reason}`);
        await expect(page.locator("[data-admin-interests]")).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  }
});
