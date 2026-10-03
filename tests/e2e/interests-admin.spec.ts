import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import {
  INTEREST_FORMAT_FIELDS,
  interestCourseCalendar,
} from "../fixtures/interest-course-calendar";
import { signInFixture } from "./auth-helper";
import { registerCourseInstructor } from "./instructor-helper";
import { e2eSiteUrl } from "../../scripts/e2e-port";

const headers = { Origin: e2eSiteUrl(), Accept: "application/json" };

// Only the isolated E2E server is used. Auth helper obtains the temporary
// environment and signs in through the existing Supabase Admin API.
async function interestCourse(page: Page, context: BrowserContext) {
  const instructor = await registerCourseInstructor(page);
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const name = `Interés sintético ${crypto.randomUUID()}`;
  const format = await page.request.post("/app/formatos/nuevo", {
    headers,
    form: {
      name,
      ...INTEREST_FORMAT_FIELDS,
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
      instructorId: instructor.id,
      ...interestCourseCalendar(),
      conditions: "Solicitud de interés, sin reserva.",
      requestKey: crypto.randomUUID(),
      minimumGrade: "70",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
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
  const remainingGroup = await page.request.post(groupPath, {
    headers,
    form: { intent: "create", startTime: "20:00", capacity: "1" },
  });
  expect(remainingGroup.status()).toBe(200);
  const remainingGroupId = ((await remainingGroup.json()) as { id: string }).id;
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
  return {
    id,
    name,
    path: `/app/interesados/${id}`,
    groupId: group.id,
    remainingGroupId,
  };
}

const rowFor = (page: Page, name = "Ana Sintética") =>
  page.locator("[data-interest-id]").filter({
    has: page.getByRole("heading", { name: `${name} Fixture`, exact: true }),
  });

test("filters replace only the authorized list, retain focus and handle history, failure and retry", async ({
  page,
  context,
}) => {
  const course = await interestCourse(page, context);
  await page.goto(course.path);
  const shell = await page.locator("h1").elementHandle();
  const metrics = await page.locator("[data-interest-metrics]").elementHandle();
  const all = page.getByRole("button", { name: "Todos", exact: true });
  const active = page.getByRole("button", { name: "Activos", exact: true });
  const cancelled = page.getByRole("button", {
    name: "Cancelados",
    exact: true,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${course.path}?status=ACTIVE`, async (route) => {
    await gate;
    await route.continue();
  });
  await active.focus();
  await active.press("Enter");
  await expect(page.locator("[data-filter-skeleton]")).toBeVisible();
  await expect(page.locator("[data-navigation-skeleton]")).toBeHidden();
  await cancelled.click();
  await expect(cancelled).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-interests-empty]")).toBeVisible();
  release();
  await expect(page).toHaveURL(`${course.path}?status=CANCELLED`);
  await expect(cancelled).toBeFocused();
  expect(await shell!.evaluate((node) => node.isConnected)).toBe(true);
  expect(await metrics!.evaluate((node) => node.isConnected)).toBe(true);
  await all.click();
  await expect(page.locator("[data-interest-id]")).toHaveCount(2);
  await page.goBack();
  await expect(cancelled).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-interests-empty]")).toBeVisible();
  expect(await shell!.evaluate((node) => node.isConnected)).toBe(true);
  await page.goForward();
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-interest-id]")).toHaveCount(2);
  await page.unroute(`**${course.path}?status=ACTIVE`);
  await page.route(`**${course.path}?status=ACTIVE`, (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await active.click();
  await expect(page.locator("[data-interests-error]")).toContainText(
    "Reintenta",
  );
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-interest-id]")).toHaveCount(2);
  await expect(page.locator("[data-filter-skeleton]")).toBeHidden();
  await page.unroute(`**${course.path}?status=ACTIVE`);
  await page.route(`**${course.path}?status=ACTIVE`, (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/html", "X-Interest-Fragment": "1" },
      body: `<div data-admin-interests data-course-id="${crypto.randomUUID()}" data-filter="ACTIVE"><ul data-interest-list></ul></div>`,
    }),
  );
  await page.getByRole("button", { name: "Reintentar filtro" }).click();
  await expect(page.locator("[data-interests-error]")).toContainText(
    "validar el listado",
  );
  await expect(page.locator("[data-interest-id]")).toHaveCount(2);
  await page.unroute(`**${course.path}?status=ACTIVE`);
  await page.getByRole("button", { name: "Reintentar filtro" }).click();
  await expect(active).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-interests-error]")).toBeHidden();
  // Replaced cards keep the original delegated confirmation/mutation behavior.
  await confirmAction(page, rowFor(page), "Cancelar interés");
  await expect(rowFor(page)).toHaveCount(0);
});

test("fragment GET validates filters and never grants interest data to non-admin sessions", async ({
  page,
  context,
}) => {
  const course = await interestCourse(page, context);
  const fragmentHeaders = { "X-Interest-Fragment": "1" };
  const valid = await page.request.get(`${course.path}?status=CANCELLED`, {
    headers: fragmentHeaders,
  });
  expect(valid.status()).toBe(200);
  expect(valid.headers()["cache-control"]).toContain("no-store");
  const html = await valid.text();
  expect(html).toContain("data-admin-interests");
  expect(html).not.toContain("Ana Sintética");
  expect(html).not.toContain("<h1");
  for (const query of [
    "status=invalid",
    "status=",
    "status=ACTIVE&status=ALL",
  ]) {
    const invalid = await page.request.get(`${course.path}?${query}`, {
      headers: fragmentHeaders,
    });
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await invalid.text()).not.toContain("Ana Sintética");
  }
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  const denied = await page.request.get(course.path, {
    headers: fragmentHeaders,
    maxRedirects: 0,
  });
  expect(denied.status()).toBe(303);
  expect(denied.headers().location).toContain("unauthorized");
  expect(await denied.text()).not.toContain("Ana Sintética");
  await context.clearCookies();
  const anonymous = await page.request.get(course.path, {
    headers: fragmentHeaders,
    maxRedirects: 0,
  });
  expect(anonymous.status()).toBe(303);
  expect(anonymous.headers().location).toContain("login");
  expect(await anonymous.text()).not.toContain("Ana Sintética");
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
  const courseCard = page.getByRole("link", { name: new RegExp(course.name) });
  await expect(
    courseCard.getByText("Interesados activos", { exact: true }),
  ).toBeVisible();
  await expect(courseCard.getByText("2", { exact: true })).toBeVisible();
  await courseCard.click();
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
  await expect(
    page.getByText(
      "Cada barra muestra la proporción del total de interesados activos.",
    ),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-demand-row][data-leading="true"]'),
  ).toHaveCount(2);
  await expect(page.locator("[data-demand-row]")).toHaveCount(3);
  await expect(
    page.locator(`[data-preference-id="${course.remainingGroupId}"]`),
  ).toHaveText("0");
  for (const demand of await page.locator("[data-demand-row]").all()) {
    const preference = await demand
      .locator("[data-preference-id]")
      .getAttribute("data-preference-id");
    expect(
      await demand
        .locator("[data-demand-bar]")
        .evaluate(
          (bar) =>
            bar.getBoundingClientRect().width /
            bar.parentElement!.getBoundingClientRect().width,
        ),
    ).toBeCloseTo(preference === course.remainingGroupId ? 0 : 0.5);
  }
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
  await expect(
    page.locator(`[data-demand-row="${course.groupId}"]`),
  ).toHaveAttribute("data-leading", "false");
  await expect(page.locator('[data-demand-row=""]')).toHaveAttribute(
    "data-leading",
    "true",
  );
  await expect(row.locator('input[name="revision"]')).not.toHaveValue(revision);
  expect(await originalRow?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(row.locator("summary")).toBeFocused();
  await confirmAction(page, row, "Reactivar interés");
  await expect(row.locator("[data-interest-status]")).toHaveText("Activo");
  await expect(page.locator("[data-active-total]")).toHaveText("2");
  await expect(
    page.locator('[data-demand-row][data-leading="true"]'),
  ).toHaveCount(2);
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
    page.getByRole("button", { name: "Activos", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-interests-empty]")).toBeVisible();
  await expect(page.locator("[data-active-total]")).toHaveText("0");
  await expect(
    page.locator('[data-demand-row][data-leading="true"]'),
  ).toHaveCount(0);
  for (const bar of await page.locator("[data-demand-bar]").all()) {
    expect((await bar.boundingBox())!.width).toBe(0);
  }
  await expect(
    page.getByRole("heading", { name: "Registros de interés" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("interest cards and demand use the available width across mobile, tablet and desktop", async ({
  page,
  context,
}) => {
  const course = await interestCourse(page, context);
  await page.goto(course.path);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    // Sidebar/scrollbar layout may settle after a breakpoint change. Check the
    // observable full-width relationship, not a fixed wait or animation timing.
    await expect
      .poll(async () => {
        const root = await page.locator("[data-admin-interests]").boundingBox();
        const demand = await page
          .getByRole("region", { name: "Interesados activos" })
          .boundingBox();
        return Math.abs(root!.width - demand!.width);
      })
      .toBeLessThanOrEqual(1);
    const root = await page.locator("[data-admin-interests]").boundingBox();
    const first = await page.locator("[data-interest-id]").nth(0).boundingBox();
    const second = await page
      .locator("[data-interest-id]")
      .nth(1)
      .boundingBox();
    if (width < 768) {
      expect(first!.x).toBe(second!.x);
      expect(first!.width).toBeCloseTo(root!.width);
      expect(second!.y).toBeGreaterThan(first!.y);
    } else {
      await expect
        .poll(async () => {
          const [a, b] = await Promise.all([
            page.locator("[data-interest-id]").nth(0).boundingBox(),
            page.locator("[data-interest-id]").nth(1).boundingBox(),
          ]);
          return a && b ? b.y - a.y : null;
        })
        .toBe(0);
      expect(second!.x).not.toBe(first!.x);
    }
    await expect(rowFor(page).getByRole("link")).toHaveCount(0);
    await rowFor(page).locator("summary").focus();
    await expect(rowFor(page).locator("summary")).toBeFocused();
  }
});

test("pending interest navigation uses its structural skeleton, then restores the real cards", async ({
  page,
  context,
}) => {
  const course = await interestCourse(page, context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app/interesados");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${course.path}`, async (route) => {
    const response = await route.fetch();
    await pending;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("link", { name: new RegExp(course.name) }).click();
    const skeleton = page.locator("[data-navigation-skeleton]");
    await expect(skeleton).toBeVisible();
    await expect(skeleton.locator("[data-loading-layout]")).toHaveAttribute(
      "data-loading-layout",
      "interests",
    );
    await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(
      await skeleton
        .locator('[data-slot="skeleton"]')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("none");
  } finally {
    release();
  }
  await expect(page).toHaveURL(course.path);
  await expect(rowFor(page)).toBeVisible();
  await expect(page.locator("[data-navigation-skeleton]")).toBeHidden();
  await expect(page.getByRole("main")).not.toHaveAttribute("aria-busy", "true");
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
    await html.getByRole("button", { name: "Cancelados", exact: true }).click();
    await expect(html).toHaveURL(`${course.path}?status=CANCELLED`);
    await expect(html.locator("[data-interest-id]")).toHaveCount(1);
    await expect(
      html.getByRole("button", { name: "Cancelados", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await html.getByRole("button", { name: "Todos", exact: true }).click();
    await expect(html).toHaveURL(`${course.path}?status=ALL`);
    await expect(html.locator("[data-interest-id]")).toHaveCount(2);
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
