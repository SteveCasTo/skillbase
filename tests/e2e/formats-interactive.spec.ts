import { expect, test } from "@playwright/test";

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
  await expect(page.locator("[data-sileo-toast]")).toContainText(
    "Formato creado",
  );
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
  await page.getByLabel("Precio estudiante (BOB)").fill("80");
  await page.getByLabel("Precio externo (BOB)").fill("100");
  await page.getByRole("button", { name: "Crear formato" }).click();
  await page.getByRole("link", { name: new RegExp(name) }).click();
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
  await form.getByRole("button", { name: "Guardar precio estudiante" }).click();
  await expect(page.getByText("90.25 BOB")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationMarker?: boolean }).navigationMarker,
    ),
  ).toBe(true);
  await expect(page.locator('input[name="revisionId"]').first()).toHaveValue(
    /.+/,
  );
  await edit.click();
  await input.fill("95.00");
  await form.getByRole("button", { name: "Guardar precio estudiante" }).click();
  await expect(page.getByText("95.00 BOB")).toBeVisible();
  const stale = await page.request.post(path, {
    headers: { Origin: "http://127.0.0.1:4321" },
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
  await expect(
    page.getByRole("button", { name: "Sí, eliminar formato" }),
  ).toBeHidden();
  await deleteButton.click();
  await expect(deleteButton).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(deleteButton).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
});
