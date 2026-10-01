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

const successMessage =
  "Gracias por tu interés. Esta solicitud no reserva una plaza ni confirma una inscripción.";
const origin = "http://127.0.0.1:4321";
const headers = { Origin: origin, Accept: "application/json" };
const submitName = "Dejar mis datos de interés";

/** Create isolated synthetic courses through the established admin HTTP flow. */
async function publicCourse(
  page: Page,
  context: BrowserContext,
  options: { group?: boolean; window?: "future" | "closed" } = {},
) {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const suffix = crypto.randomUUID();
  const name = `Interés público E2E ${suffix}`;
  const format = await page.request.post("/app/formatos/nuevo", {
    headers,
    form: {
      name: `Formato interés ${suffix}`,
      ...INTEREST_FORMAT_FIELDS,
    },
  });
  expect(format.status()).toBe(201);
  const courseTypeId = ((await format.json()) as { id: string }).id;
  const calendar = interestCourseCalendar();
  const future = new Date(`${calendar.startDate}T00:00:00Z`);
  const registrationStart = new Date(future);
  registrationStart.setUTCDate(registrationStart.getUTCDate() - 3);
  const registrationEnd = new Date(future);
  registrationEnd.setUTCDate(registrationEnd.getUTCDate() - 1);
  const window =
    options.window === "future"
      ? {
          registrationStartAt: `${registrationStart.toISOString().slice(0, 10)}T00:00`,
          registrationEndAt: `${registrationEnd.toISOString().slice(0, 10)}T23:59`,
        }
      : options.window === "closed"
        ? {
            registrationStartAt: "2020-01-01T00:00",
            registrationEndAt: "2020-01-02T00:00",
          }
        : {};
  const created = await page.request.post("/app/cursos/nuevo", {
    headers,
    form: {
      name,
      description: "Curso sintético para comprobar el registro de interés.",
      courseTypeId,
      level: "BASIC",
      ...calendar,
      conditions: "Condiciones del curso de prueba.",
      minimumGrade: "70",
      requestKey: crypto.randomUUID(),
      ...window,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id, revision } = (await created.json()) as {
    id: string;
    revision: string;
  };
  let groupId: string | undefined;
  if (options.group) {
    const group = await page.request.post(`/app/cursos/${id}/grupos`, {
      headers,
      form: { intent: "create", startTime: "18:00", capacity: "1" },
    });
    expect(group.status()).toBe(200);
    groupId = ((await group.json()) as { id: string }).id;
  }
  const published = await page.request.post(`/app/cursos/${id}/editar`, {
    headers,
    form: { intent: "publish", revision },
  });
  expect(published.status()).toBe(200);
  await context.clearCookies();
  await page.goto("/cursos");
  const link = page.getByRole("link", {
    name: `Ver curso: ${name}`,
    exact: true,
  });
  await expect(link).toBeVisible();
  const path = await link.getAttribute("href");
  expect(path).toBeTruthy();
  await page.goto(path!);
  return { path: path!, groupId, courseId: id };
}

async function fillContact(
  page: Page,
  email = `interest-${crypto.randomUUID()}@example.test`,
) {
  const form = page.getByRole("form", { name: submitName });
  await form.getByLabel("Nombre", { exact: true }).fill("María José");
  await form.getByLabel("Apellidos", { exact: true }).fill("Pérez García");
  await form.getByLabel("Email", { exact: true }).fill(email);
  return { form, email };
}

async function submitNativeInterest(form: Locator) {
  // Keep browser constraints enabled. Keyboard activation avoids Playwright's
  // repeated auto-scroll of an offscreen button on the smooth-scrolling page.
  expect(
    await form.evaluate((element) =>
      (element as HTMLFormElement).checkValidity(),
    ),
  ).toBe(true);
  const button = form.getByRole("button", { name: submitName });
  await expect(button).toBeEnabled();
  await button.focus();
  await expect(button).toBeFocused();
  await button.press("Enter");
}

test("interest is available before presencial opening; JS submits optional group without reserving and duplicates stay neutral", async ({
  page,
  context,
}) => {
  const { path, groupId } = await publicCourse(page, context, {
    group: true,
    window: "future",
  });
  await expect(page.locator(".course-status")).toHaveText(
    "Preinscripción presencial próxima",
  );
  await page.getByRole("link", { name: submitName, exact: true }).click();
  const { form, email } = await fillContact(page);
  await expect(form).toHaveAttribute("novalidate", "");
  const group = form.getByRole("combobox", {
    name: "Preferencia de grupo (opcional)",
  });
  await expect(group).toContainText("Sin preferencia");
  await group.click();
  await page
    .getByRole("option", { name: "Lunes a viernes, 18:00–19:30" })
    .click();
  await page.evaluate(() => {
    (
      window as Window & { publicInterestMarker?: boolean }
    ).publicInterestMarker = true;
  });
  const firstResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === path,
  );
  await form.getByRole("button", { name: submitName }).click();
  const first = await firstResponse;
  expect(first.status()).toBe(200);
  expect(first.request().headers()["content-type"]).toContain(
    "application/x-www-form-urlencoded",
  );
  expect(
    new URLSearchParams(first.request().postData() ?? "").getAll(
      "preferredGroupId",
    ),
  ).toEqual([groupId]);
  expect(
    new URLSearchParams(first.request().postData() ?? "").get("phone"),
  ).toBe("");
  const firstPayload: unknown = await first.json();
  expect(firstPayload).toEqual({ ok: true, message: successMessage });
  await expect(page.locator(".interest-success")).toContainText(successMessage);
  await expect(page.locator(".interest-success")).toBeFocused();
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Gracias por tu interés",
  );
  expect(
    await page.evaluate(
      () =>
        (window as Window & { publicInterestMarker?: boolean })
          .publicInterestMarker,
    ),
  ).toBe(true);
  await expect(page.locator("#interes")).not.toContainText(email);
  expect(page.url()).not.toContain(email);
  expect(
    await page.evaluate(() => JSON.stringify(Object.entries(localStorage))),
  ).not.toContain(email);

  await page.goto(path);
  const duplicate = await fillContact(page, email.toUpperCase());
  await duplicate.form
    .getByLabel("Nombre", { exact: true })
    .fill("Otro nombre declarado");
  await expect(duplicate.form).toHaveAttribute("novalidate", "");
  const secondResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === path,
  );
  await duplicate.form.getByRole("button", { name: submitName }).click();
  const second = await secondResponse;
  expect(second.status()).toBe(200);
  expect(await second.json()).toEqual(firstPayload);
  await expect(page.locator(".interest-success")).toContainText(successMessage);
});

test("without a registration window or groups, native HTML still preserves errors and reaches neutral success", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL: baseURL ?? origin,
    javaScriptEnabled: false,
  });
  try {
    const page = await context.newPage();
    const { path } = await publicCourse(page, context);
    const { form } = await fillContact(page);
    await expect(form).not.toHaveAttribute("novalidate");
    await expect(
      form.getByText("Sin preferencia", { exact: true }),
    ).toBeVisible();
    await expect(form.locator('[name="preferredGroupId"]')).toHaveCount(0);
    await form.getByLabel("Nombre", { exact: true }).fill("   ");
    const rejected = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === path,
    );
    await submitNativeInterest(form);
    const rejection = await rejected;
    expect(rejection.status()).toBe(422);
    expect(rejection.headers()["cache-control"]).toContain("no-store");
    await expect(page.locator(".interest-error-summary")).toBeVisible();
    await expect(form.getByLabel("Apellidos", { exact: true })).toHaveValue(
      "Pérez García",
    );
    await expect(form.getByLabel("Nombre", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await form.getByLabel("Nombre", { exact: true }).fill("María José");
    const accepted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === path,
    );
    await submitNativeInterest(form);
    expect((await accepted).status()).toBe(200);
    await expect(page.locator(".interest-success")).toContainText(
      successMessage,
    );
    await expect(page.getByRole("form", { name: submitName })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("native group selector has one successful UUID field without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL: baseURL ?? origin,
    javaScriptEnabled: false,
  });
  try {
    const page = await context.newPage();
    const { path, groupId } = await publicCourse(page, context, {
      group: true,
    });
    const { form } = await fillContact(page);
    await form
      .getByLabel("Preferencia de grupo (opcional)")
      .selectOption(groupId!);
    await expect(form).not.toHaveAttribute("novalidate");
    const posted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === path,
    );
    await submitNativeInterest(form);
    const response = await posted;
    expect(response.status()).toBe(200);
    expect(
      new URLSearchParams(response.request().postData() ?? "").getAll(
        "preferredGroupId",
      ),
    ).toEqual([groupId]);
    await expect(page.locator(".interest-success")).toContainText(
      successMessage,
    );
  } finally {
    await context.close();
  }
});

test("required validity gates submit; server field issues preserve input and focus, preference can be cleared", async ({
  page,
  context,
}) => {
  const { path } = await publicCourse(page, context, { group: true });
  const emptyForm = page.getByRole("form", { name: submitName });
  await expect(emptyForm).toHaveAttribute("novalidate", "");
  const submit = emptyForm.getByRole("button", { name: submitName });
  await expect(submit).toBeDisabled();
  const { form, email } = await fillContact(page);
  await expect(form).toHaveAttribute("novalidate", "");
  await expect(submit).toBeEnabled();
  await form.getByLabel("Nombre", { exact: true }).fill("   ");
  await expect(submit).toBeDisabled();
  await expect(form.getByLabel("Email", { exact: true })).toHaveValue(email);
  await form.getByLabel("Nombre", { exact: true }).fill("María José");
  await form.getByLabel("Apellidos", { exact: true }).fill("   ");
  await expect(submit).toBeDisabled();
  await form.getByLabel("Apellidos", { exact: true }).fill("Pérez García");
  await form.getByLabel("Email", { exact: true }).fill("not-an-email");
  await expect(submit).toBeDisabled();
  await form.getByLabel("Email", { exact: true }).fill(email);
  await expect(submit).toBeEnabled();
  await form.getByLabel("Teléfono (opcional)").evaluate((element) => {
    (element as HTMLInputElement).value = "1".repeat(33);
  });
  await form.getByRole("button", { name: submitName }).click();
  await expect(form.getByLabel("Teléfono (opcional)")).toBeFocused();
  await expect(form.getByLabel("Teléfono (opcional)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(form.getByLabel("Teléfono (opcional)")).toHaveValue(
    "1".repeat(33),
  );
  await form.getByLabel("Teléfono (opcional)").fill("");
  await form.locator('input[name="preferredGroupId"]').evaluate((element) => {
    (element as HTMLInputElement).value = crypto.randomUUID();
  });
  await form.getByRole("button", { name: submitName }).click();
  const group = form.getByRole("combobox", {
    name: "Preferencia de grupo (opcional)",
  });
  await expect(group).toBeFocused();
  await expect(group).toHaveAttribute("aria-invalid", "true");
  await expect(form.locator("#interest-preferredGroupId-error")).toHaveText(
    "Selecciona una preferencia disponible o continúa sin preferencia.",
  );
  await group.click();
  await page
    .getByRole("option", { name: "Sin preferencia", exact: true })
    .click();
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === path,
  );
  await form.getByRole("button", { name: submitName }).click();
  expect((await posted).status()).toBe(200);
  await expect(page.locator(".interest-success")).toContainText(successMessage);
});

test("closed detail has no form or interest CTA; server closure after GET removes the stale form", async ({
  page,
  context,
}) => {
  await publicCourse(page, context, { window: "closed" });
  await expect(
    page.getByText("Registro de interés cerrado", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("form", { name: submitName })).toHaveCount(0);
  await expect(page.getByRole("link", { name: submitName })).toHaveCount(0);
  const { path } = await publicCourse(page, context);
  const { form } = await fillContact(page);
  await expect(form).toHaveAttribute("novalidate", "");
  // Deterministic UI coverage of the authoritative deadline response, not a browser clock race.
  await page.route(`**${path}`, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            code: "INTEREST_UNAVAILABLE",
            message: "Este curso ya no recibe registros de interés.",
            issues: {},
          }),
        })
      : route.continue(),
  );
  await form.getByRole("button", { name: submitName }).click();
  await expect(
    page.getByText("Registro de interés cerrado", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("form", { name: submitName })).toHaveCount(0);
  await expect(page.locator("#interes .interest-result")).toBeFocused();
});

test("pending is local, network failures preserve contact and can retry without navigation", async ({
  page,
  context,
}) => {
  const { path } = await publicCourse(page, context);
  const { form, email } = await fillContact(page);
  await expect(form).toHaveAttribute("novalidate", "");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await gate;
    await route.abort("failed");
  });
  await form.getByRole("button", { name: submitName }).click();
  await expect(form.getByRole("button", { name: "Enviando…" })).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "Condiciones" }),
  ).toBeVisible();
  release();
  await expect(form.locator(".interest-error-summary")).toBeFocused();
  await expect(form.getByLabel("Email", { exact: true })).toHaveValue(email);
  await expect(form.getByRole("button", { name: submitName })).toBeEnabled();
  await page.unroute(`**${path}`);
  await form.getByRole("button", { name: submitName }).click();
  await expect(page.locator(".interest-success")).toContainText(successMessage);
});

test("mobile, tablet and desktop keep readable controls, keyboard access and both public themes", async ({
  page,
  context,
}) => {
  await publicCourse(page, context, { group: true });
  const form = page.getByRole("form", { name: submitName });
  await expect(form).toHaveAttribute("novalidate", "");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    const formBounds = await form.boundingBox();
    const submitBounds = await form
      .getByRole("button", { name: submitName })
      .boundingBox();
    expect(
      Math.abs(formBounds!.width - submitBounds!.width),
    ).toBeLessThanOrEqual(1);
    await form.getByLabel("Nombre", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(form.getByLabel("Apellidos", { exact: true })).toBeFocused();
    const group = form.getByRole("combobox", {
      name: "Preferencia de grupo (opcional)",
    });
    await group.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(group).toBeFocused();
    expect(
      (await form.getByLabel("Email", { exact: true }).boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    for (const dark of [false, true]) {
      await page.evaluate(
        (enabled) => document.documentElement.classList.toggle("dark", enabled),
        dark,
      );
      const colors = await form
        .getByLabel("Email", { exact: true })
        .evaluate((input) => ({
          color: getComputedStyle(input).color,
          background: getComputedStyle(input.closest(".public-interest")!)
            .getPropertyValue("--paper")
            .trim(),
        }));
      expect(colors.background).toBe(dark ? "#0d1d28" : "#fff");
      expect(colors.color).not.toBe("rgba(0, 0, 0, 0)");
    }
  }
});
