import { expect, test } from "@playwright/test";

import { e2eSiteUrl } from "../../scripts/e2e-port";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test("create form filters edits and enables submit only for valid required values", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/formatos/nuevo");
  const form = page.getByRole("form", { name: "Crear formato" });
  const submit = form.getByRole("button", { name: "Crear formato" });
  const name = form.getByLabel("Nombre");
  const hours = form.getByLabel("Duración total (horas)");
  const session = form.getByLabel("Duración de sesión (minutos)");
  const student = form.getByLabel("Precio estudiante (BOB)");
  const external = form.getByLabel("Precio externo (BOB)");
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveCSS("opacity", "0.4");
  await name.fill("Formato humano ñ");
  await hours.pressSequentially("2a4");
  await expect(hours).toHaveValue("24");
  await hours.fill("2147483647");
  await hours.press("8");
  await expect(hours).toHaveValue("2147483647");
  await hours.fill("24");
  await session.fill("90");
  await student.pressSequentially("80.5a0");
  await expect(student).toHaveValue("80.50");
  await student.press("9");
  await expect(student).toHaveValue("80.50");
  const invalidDropRejected = await student.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData("text", "oops");
    return !element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  });
  expect(invalidDropRejected).toBe(true);
  await expect(student).toHaveValue("80.50");
  await external.fill("100");
  await expect(submit).toBeEnabled();
  await student.fill("80.");
  await expect(student).toHaveValue("80.");
  await expect(submit).toBeDisabled();
  await student.press("5");
  await expect(submit).toBeEnabled();
  await external.fill("");
  await expect(submit).toBeDisabled();
  await external.fill("100");
  await name.fill("  ");
  await expect(submit).toBeDisabled();
  const formatName = `Formato interacción ${Date.now()}`;
  await name.fill(formatName);
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/app\/formatos$/);
  await expect(
    page.getByRole("link", { name: new RegExp(formatName) }),
  ).toBeVisible();
  await expect(
    page.locator("[data-sileo-toast]").filter({ hasText: "Formato creado" }),
  ).toBeVisible();
});

test("inline editing swaps icons in the same row, filters input and cancels without navigation", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/formatos/nuevo");
  const name = `Formato iconos ${Date.now()}`;
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Duración total (horas)").fill("24");
  await page.getByLabel("Duración de sesión (minutos)").fill("90");
  await page.getByLabel("Precio estudiante (BOB)").fill("80");
  await page.getByLabel("Precio externo (BOB)").fill("100");
  await page.getByRole("button", { name: "Crear formato" }).click();
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(
    page.locator('[data-format-value="sessionMinutes"]'),
  ).toContainText("90 minutos");
  await page.locator('summary[aria-label="Editar duración de sesión"]').click();
  await page
    .getByRole("form", { name: "Editar duración de sesión" })
    .getByLabel("Nueva duración de sesión")
    .fill("150");
  await page
    .getByRole("form", { name: "Editar duración de sesión" })
    .getByRole("button", { name: "Guardar duración de sesión" })
    .click();
  await expect(
    page.locator('[data-format-value="sessionMinutes"]'),
  ).toContainText("150 minutos");
  await page.setViewportSize({ width: 320, height: 700 });
  const path = new URL(page.url()).pathname;
  const row = page.locator("dl > div").filter({
    has: page.getByText("Precio estudiante", { exact: true }),
  });
  const edit = row.locator('summary[aria-label="Editar precio estudiante"]');
  await expect(row).toHaveCount(1);
  await expect(edit).toBeVisible();
  const before = await row.boundingBox();
  await expect(edit).toHaveAttribute("title", "Editar precio estudiante");
  await edit.focus();
  await page.keyboard.press("Enter");
  const form = page.getByRole("form", { name: "Editar precio estudiante" });
  const input = form.getByLabel("Nuevo precio estudiante");
  await expect(input).toBeFocused();
  await expect(edit).toBeHidden();
  const save = form.getByRole("button", { name: "Guardar precio estudiante" });
  const cancel = form.getByRole("button", {
    name: "Cancelar edición de precio estudiante",
  });
  await expect(save).toBeVisible();
  await expect(save.locator("svg")).toBeVisible();
  await expect(cancel).toBeVisible();
  await expect(cancel.locator("svg")).toBeVisible();
  const after = await row.boundingBox();
  expect(after?.height).toBe(before?.height);
  await input.fill("80.");
  await input.pressSequentially("5x0");
  await expect(input).toHaveValue("80.50");
  await input.evaluate((element: HTMLInputElement) => element.select());
  const pastePrevented = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      "#edit-studentAmount",
    );
    if (input) {
      const transfer = new DataTransfer();
      transfer.setData("text", "999xyz");
      return !input.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
    }
    return false;
  });
  expect(pastePrevented).toBe(true);
  await expect(input).toHaveValue("80.50");
  await form
    .getByRole("button", { name: "Cancelar edición de precio estudiante" })
    .click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(edit).toBeFocused();
  await expect(edit).toBeVisible();
  await expect(page.getByText("80.00 BOB")).toBeVisible();
  await edit.click();
  await expect(input).toHaveValue("80.00");
  await input.fill("90.25");
  await page.evaluate(() => {
    (window as Window & { navigationMarker?: boolean }).navigationMarker = true;
  });
  await page.locator('summary[aria-label="Editar precio externo"]').click();
  const otherEditor = page.getByRole("form", { name: "Editar precio externo" });
  await otherEditor.getByLabel("Nuevo precio externo").fill("123.45");
  await otherEditor.evaluate((node) => {
    (
      window as Window & { retainedFormatEditor?: Element }
    ).retainedFormatEditor = node;
  });
  let samePageGets = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === path)
      samePageGets++;
  });
  let releaseSave!: () => void;
  const pendingSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let requests = 0;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    requests++;
    const response = await route.fetch();
    await pendingSave;
    await route.fulfill({ response });
  });
  await form.getByRole("button", { name: "Guardar precio estudiante" }).click();
  await expect(input).toHaveJSProperty("readOnly", true);
  await input.focus();
  await input.press("9");
  await expect(input).toHaveValue("90.25");
  await otherEditor.getByLabel("Nuevo precio externo").focus();
  releaseSave();
  await expect(page.getByText("90.25 BOB")).toBeVisible();
  expect(requests).toBe(1);
  await expect(form).toBeHidden();
  await expect(edit).toBeVisible();
  await expect(otherEditor.getByLabel("Nuevo precio externo")).toBeFocused();
  await page.unroute(`**${path}`);
  await expect(otherEditor).toBeVisible();
  await expect(otherEditor.getByLabel("Nuevo precio externo")).toHaveValue(
    "123.45",
  );
  expect(
    await otherEditor.evaluate(
      (node) =>
        (window as Window & { retainedFormatEditor?: Element })
          .retainedFormatEditor === node,
    ),
  ).toBe(true);
  expect(samePageGets).toBe(0);
  await otherEditor
    .getByRole("button", { name: "Cancelar edición de precio externo" })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
  await expect(form).toBeHidden();
  await expect(edit).toBeVisible();
  await expect(page.locator('input[name="revisionId"]').first()).toHaveValue(
    /.+/,
  );
  await edit.click();
  await expect(input).toBeEditable();
  await expect(input).toHaveValue("90.25");
  await input.fill("95.00");
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ deleted: true }),
      });
    else await route.continue();
  });
  await form.getByRole("button", { name: "Guardar precio estudiante" }).click();
  await expect(form).toBeVisible();
  await expect(form.locator("#error-studentAmount")).toContainText(
    "No se pudo confirmar",
  );
  await expect(input).toHaveValue("95.00");
  await expect(input).toBeEditable();
  await page.unroute(`**${path}`);
  await form.getByRole("button", { name: "Guardar precio estudiante" }).click();
  await expect(page.getByText("95.00 BOB")).toBeVisible();
  const stale = await page.request.post(path, {
    headers: { Origin: e2eSiteUrl() },
    form: {
      intent: "revise",
      field: "studentAmount",
      value: "invalid server value",
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
  expect(stale.status()).toBe(422);
  expect(await stale.text()).toContain("invalid server value");
  expect(await stale.text()).toContain("Ingresa un monto no negativo");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  const deleteButton = page.getByRole("button", {
    name: "Eliminar formato",
    exact: true,
  });
  await expect(deleteButton).toBeVisible();
  await expect(page.locator("[data-action-dialog]")).toBeHidden();
  await deleteButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "¿Eliminar formato?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("No se puede deshacer");
  await page.getByRole("button", { name: "Volver", exact: true }).click();
  await expect(deleteButton).toBeFocused();
  await expect(dialog).toBeHidden();
  const detailPath = new URL(page.url()).pathname;
  let releaseFailure!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  let attempts = 0;
  await page.route(`**${detailPath}`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    attempts++;
    await gate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Fallo recuperable de prueba." }),
    });
  });
  await deleteButton.click();
  await dialog.getByRole("button", { name: "Eliminar formato" }).click();
  await expect(dialog).toBeHidden();
  // Sileo keeps dismissed toasts in the DOM while they exit; only the live
  // loading toast represents this delete operation.
  const activeLoadingToast = page.locator(
    '[data-sileo-toast][data-state="loading"][data-exiting="false"]',
  );
  await expect(activeLoadingToast).toHaveCount(1);
  await expect(activeLoadingToast).toBeVisible();
  await page
    .locator("[data-dialog-form]")
    .evaluate((form) =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
  releaseFailure();
  await expect(page.locator("[data-action-error]")).toContainText(
    "Fallo recuperable de prueba.",
  );
  expect(attempts).toBe(1);
  await expect(
    page.getByRole("button", { name: "Reintentar acción" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.unroute(`**${detailPath}`);
  await deleteButton.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(deleteButton).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${path}$`));

  const revisionId = await page
    .locator('input[name="revisionId"]')
    .first()
    .inputValue();
  const updatedAt = await page
    .locator('input[name="updatedAt"]')
    .first()
    .inputValue();
  const conflict = await page.request.post(path, {
    headers: { Origin: e2eSiteUrl() },
    form: {
      intent: "rename",
      field: "name",
      value: `${name} actualizado`,
      revisionId,
      updatedAt,
    },
    maxRedirects: 0,
  });
  expect(conflict.status()).toBe(303);
  await deleteButton.click();
  await dialog.getByRole("button", { name: "Eliminar formato" }).click();
  await expect(page.locator("[data-action-error]")).toContainText(
    "Recarga y revisa",
  );
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await page.reload();
  await page.evaluate(() => {
    (window as Window & { navigationMarker?: boolean }).navigationMarker = true;
  });
  await page
    .getByRole("button", { name: "Eliminar formato", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "¿Eliminar formato?" })
    .getByRole("button", { name: "Eliminar formato" })
    .click();
  await expect(page).toHaveURL(/\/app\/formatos$/);
  await expect(
    page.getByRole("heading", { name: "Formatos de curso" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
});

test("used formats toggle availability in place and disable editors while inactive", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/formatos/nuevo");
  const name = `Formato en uso ${Date.now()}`;
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Duración total (horas)").fill("24");
  await page.getByLabel("Duración de sesión (minutos)").fill("90");
  await page.getByLabel("Precio estudiante (BOB)").fill("80");
  await page.getByLabel("Precio externo (BOB)").fill("100");
  await page.getByRole("button", { name: "Crear formato" }).click();
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(/\/app\/formatos\/[0-9a-f-]+$/);
  const path = new URL(page.url()).pathname;
  const id = path.split("/").at(-1)!;
  const created = await page.request.post("/app/cursos/nuevo", {
    headers: { Origin: e2eSiteUrl(), Accept: "application/json" },
    form: {
      name: `Curso formato en uso ${Date.now()}`,
      requestKey: crypto.randomUUID(),
      description: "Curso para probar el estado del formato asociado.",
      level: "INTERMEDIATE",
      courseTypeId: id,
      schedule: "Lunes a viernes, 18:30–20:00",
      weekdays: "1,2,3,4,5",
      conditions: "Sujeto a cupo.",
      startsAt: "2027-03-01T18:30",
      endsAt: "2027-03-22T20:00",
      minimumGrade: "70",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Eliminar formato" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as Window & { navigationMarker?: boolean }).navigationMarker = true;
  });
  await page.locator('summary[aria-label="Editar nombre"]').click();
  const nameEditor = page.getByRole("form", { name: "Editar nombre" });
  await nameEditor.getByLabel("Nuevo nombre").fill(`${name} pendiente`);
  await page.getByRole("button", { name: "Desactivar formato" }).click();
  const dialog = page.getByRole("dialog", { name: "¿Desactivar formato?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Desactivar formato" }).click();
  await expect(page.locator("[data-format-status]")).toHaveText("Inactivo");
  await expect(
    page.getByRole("button", { name: "Activar formato" }),
  ).toBeVisible();
  await expect(
    page.locator('summary[aria-label="Editar nombre"]'),
  ).toBeHidden();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Activar formato" }).click();
  await expect(page.locator("[data-format-status]")).toHaveText("Activo");
  await expect(nameEditor).toBeVisible();
  await expect(nameEditor.getByLabel("Nuevo nombre")).toHaveValue(
    `${name} pendiente`,
  );
  await expect(
    page.getByRole("button", { name: "Desactivar formato" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
});
