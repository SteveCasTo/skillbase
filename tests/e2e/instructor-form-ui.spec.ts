import { expect, test } from "@playwright/test";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test("admin can inline-edit only its persisted account name", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/perfil");
  const form = page.getByRole("form", { name: "Editar nombre", exact: true });
  await expect(form).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Datos de la cuenta" }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Correo electrónico", { exact: true }),
  ).toHaveCount(0);
  await form
    .getByRole("button", { name: "Editar nombre", exact: true })
    .click();
  const name = form.getByLabel("Nombre", { exact: true });
  const original = await name.inputValue();
  const updatedName =
    original === "Ada Admin editada"
      ? "Ada Admin editada nuevamente"
      : "Ada Admin editada";
  const staleRevision = await form
    .locator('input[name="revision"]')
    .inputValue();
  await name.fill(updatedName);
  await form.getByRole("button", { name: /^Guardar / }).click();
  await expect(form.locator("[data-inline-value]")).toHaveText(updatedName);
  await page.reload();
  await expect(form.locator("[data-inline-value]")).toHaveText(updatedName);
  await form
    .getByRole("button", { name: "Editar nombre", exact: true })
    .click();
  const conflictingName = `${updatedName} en conflicto`;
  await name.fill(conflictingName);
  await form.locator('input[name="revision"]').evaluate((input, value) => {
    (input as HTMLInputElement).value = value;
  }, staleRevision);
  const save = form.getByRole("button", { name: /^Guardar / });
  await expect(save).toBeEnabled();
  const conflictResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/app/perfil?edit=name"),
  );
  await save.click();
  const response = await conflictResponse;
  expect(response.status()).toBe(422);
  await expect(response.json()).resolves.toMatchObject({
    error: "La cuenta cambió. Recarga antes de continuar.",
    fieldErrors: {},
  });
  const formError = form.locator("[data-form-error]");
  await expect(formError).toHaveText(
    "La cuenta cambió. Recarga antes de continuar.",
  );
  await expect(formError).toBeFocused();
  await expect(name).toHaveValue(conflictingName);
  await expect(save).toBeEnabled();
  await expect(form.locator("[data-inline-value]")).toHaveText(updatedName);
  await page.reload();
  await form
    .getByRole("button", { name: "Editar nombre", exact: true })
    .click();
  await form.getByLabel("Nombre", { exact: true }).fill(original);
  await form.getByRole("button", { name: /^Guardar / }).click();
  await expect(form.locator("[data-inline-value]")).toHaveText(original);
});

test("own profile saves fields independently, preserves other edits and advances the revision", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto("/app/perfil");
  const nameForm = page.getByRole("form", {
    name: "Editar nombre",
    exact: true,
  });
  const surnameForm = page.getByRole("form", {
    name: "Editar apellidos",
    exact: true,
  });
  await nameForm
    .getByRole("button", { name: "Editar nombre", exact: true })
    .click();
  await surnameForm
    .getByRole("button", { name: "Editar apellidos", exact: true })
    .click();
  const originalName = await nameForm
    .getByLabel("Nombre", { exact: true })
    .inputValue();
  const originalSurname = await surnameForm
    .getByLabel("Apellidos", { exact: true })
    .inputValue();
  const revision = await nameForm
    .locator('input[name="revision"]')
    .inputValue();
  await nameForm.getByLabel("Nombre", { exact: true }).fill("李 Élodie");
  await surnameForm
    .getByLabel("Apellidos", { exact: true })
    .fill("Sin guardar");
  const endpoint = /\/app\/perfil\?edit=professional$/u;
  await page.route(endpoint, (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Revisa los datos del instructor.",
        fieldErrors: { firstName: "No se pudo guardar el nombre." },
      }),
    }),
  );
  await nameForm.getByRole("button", { name: /^Guardar / }).click();
  await expect(
    nameForm.locator('[data-field-error="firstName"]'),
  ).toBeVisible();
  await expect(nameForm.getByLabel("Nombre", { exact: true })).toHaveValue(
    "李 Élodie",
  );
  await expect(nameForm.getByRole("alert")).toBeHidden();
  await expect(
    page.locator('[data-sileo-toast][data-state="loading"]'),
  ).toBeHidden();
  await expect(
    page.locator('[data-sileo-toast][data-state="error"]'),
  ).toBeHidden();
  await page.unroute(endpoint);
  await nameForm.getByRole("button", { name: /^Guardar / }).click();
  await expect(
    nameForm.getByRole("button", { name: "Editar nombre", exact: true }),
  ).toBeFocused();
  await expect(nameForm.getByLabel("Nombre", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "false",
  );
  await expect(
    surnameForm.getByLabel("Apellidos", { exact: true }),
  ).toHaveValue("Sin guardar");
  await expect(surnameForm.locator('input[name="revision"]')).not.toHaveValue(
    revision,
  );
  // A malicious request cannot replace siblings or the readonly login email.
  const response = await page.request.post("/app/perfil?edit=professional", {
    headers: { Origin: new URL(page.url()).origin, Accept: "application/json" },
    form: {
      field: "phone",
      phone: "+591 (700) 00-00",
      email: "other@example.test",
      firstName: "Forged",
      revision: await surnameForm
        .locator('input[name="revision"]')
        .inputValue(),
    },
  });
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.values).toMatchObject({
    firstName: "李 Élodie",
    lastName: originalSurname,
    email: AUTH_FIXTURES.instructor.email,
    phone: "+591 (700) 00-00",
  });
  await page.reload();
  await nameForm
    .getByRole("button", { name: "Editar nombre", exact: true })
    .click();
  await nameForm.getByLabel("Nombre", { exact: true }).fill(originalName);
  await nameForm.getByRole("button", { name: /^Guardar / }).click();
  await expect(
    nameForm.getByRole("button", { name: "Editar nombre", exact: true }),
  ).toBeFocused();
});

test("individual profile POST works without JavaScript and preserves invalid input", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await signInFixture(context, AUTH_FIXTURES.instructor.email);
    const page = await context.newPage();
    await page.goto("/app/perfil");
    const form = page.getByRole("form", {
      name: "Editar teléfono (opcional)",
      exact: true,
    });
    await form
      .getByLabel("Teléfono (opcional)", { exact: true })
      .fill("+591 70000001");
    await form.getByRole("button", { name: /^Guardar / }).click();
    await expect(page).toHaveURL(/\/app\/perfil\?status=profile_updated$/u);
    await expect(
      form.getByLabel("Teléfono (opcional)", { exact: true }),
    ).toHaveValue("+591 70000001");
    const nameForm = page.getByRole("form", {
      name: "Editar nombre",
      exact: true,
    });
    await nameForm.getByLabel("Nombre", { exact: true }).fill(" ");
    const invalid = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("edit=professional"),
    );
    await nameForm.getByRole("button", { name: /^Guardar / }).click();
    expect((await invalid).status()).toBe(422);
    await expect(nameForm.getByLabel("Nombre", { exact: true })).toHaveValue(
      " ",
    );
    await expect(
      nameForm.getByLabel("Nombre", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
  } finally {
    await context.close();
  }
});

test("creation gates valid input, exposes inline errors and toggles password by keyboard", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/instructores/nuevo");
  const form = page.locator("[data-instructor-form]");
  await expect(form).toHaveAttribute("data-bound", "true");
  const submit = form.getByRole("button", { name: "Crear instructor" });
  await expect(submit).toBeDisabled();
  const firstName = form.getByLabel("Nombre", { exact: true });
  await firstName.fill("   ");
  await firstName.blur();
  await expect(firstName).toHaveAttribute("aria-invalid", "true");
  await expect(form.locator('[data-field-error="firstName"]')).toBeVisible();
  await expect(form).toHaveJSProperty("noValidate", true);
  await firstName.fill("Ana");
  await form.getByLabel("Apellidos").fill("Sintética");
  await form.getByLabel("Correo electrónico").fill("invalid");
  const password = form.getByLabel("Contraseña inicial", { exact: true });
  await password.fill("a".repeat(12));
  await expect(submit).toBeDisabled();
  await form.getByLabel("Correo electrónico").fill("synthetic@example.test");
  const phone = form.getByLabel("Teléfono (opcional)", { exact: true });
  await phone.fill("+591 (700) 00-00");
  await phone.press("End");
  await page.keyboard.insertText("letters");
  await expect(phone).toHaveValue("+591 (700) 00-00");
  await expect(submit).toBeEnabled();
  const eye = form.locator("[data-password-toggle]");
  await expect(eye).toHaveAccessibleName("Mostrar contraseña inicial");
  await eye.focus();
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "text");
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  await expect(eye).toHaveAccessibleName("Ocultar contraseña inicial");
  await page.keyboard.press("Space");
  await expect(password).toHaveAttribute("type", "password");
  await password.fill("a".repeat(11));
  await expect(submit).toBeDisabled();
});

test("professional edit requires a valid normalized change and undo disables save", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto("/app/perfil");
  const form = page.getByRole("form", { name: "Editar nombre", exact: true });
  await expect(form).toHaveAttribute("data-bound", "true");
  await form
    .getByRole("button", { name: "Editar nombre", exact: true })
    .click();
  const submit = form.getByRole("button", { name: /^Guardar / });
  const firstName = form.getByLabel("Nombre", { exact: true });
  const original = await firstName.inputValue();
  await expect(submit).toBeDisabled();
  await firstName.fill(` ${original} `);
  await expect(submit).toBeDisabled();
  await firstName.fill(`${original} editado`);
  await expect(submit).toBeEnabled();
  await firstName.fill("   ");
  await expect(submit).toBeDisabled();
  await firstName.fill(original);
  await expect(submit).toBeDisabled();
  await form.getByRole("button", { name: /^Cancelar edición de / }).click();
  await expect(firstName).toBeHidden();
  await expect(
    form.getByRole("button", { name: "Editar nombre", exact: true }),
  ).toBeFocused();
  await expect(
    page
      .locator("[data-instructor-details]")
      .getByText(AUTH_FIXTURES.instructor.email, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Correo electrónico", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Editar correo electrónico",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("instructor and profile layouts fill available width without horizontal overflow", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto("/app/perfil");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const form = page.locator("[data-instructor-details]");
    await expect(form).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const formBox = await form.boundingBox();
    const pageBox = await page.locator("[data-private-page]").boundingBox();
    expect(formBox).not.toBeNull();
    expect(pageBox).not.toBeNull();
    expect(Math.abs(formBox!.width - pageBox!.width)).toBeLessThanOrEqual(2);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "SkillBase", exact: true });
  const account = drawer.getByRole("link", { name: "Mi perfil", exact: true });
  await expect(account).toHaveCount(1);
  await expect(account).toContainText(AUTH_FIXTURES.instructor.email);
  await expect(drawer.getByText("Mi perfil", { exact: true })).toHaveCount(0);
  const positions = await drawer
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .evaluate((element) => {
      const theme = element
        .closest(".private-mobile-actions")!
        .querySelector(".private-theme-toggle")!;
      const themeBox = theme.getBoundingClientRect();
      const logoutBox = element.getBoundingClientRect();
      return {
        themeX: themeBox.x,
        logoutX: logoutBox.x,
        themeWidth: themeBox.width,
        logoutWidth: logoutBox.width,
      };
    });
  expect(positions.themeWidth).toBeGreaterThan(0);
  expect(positions.logoutWidth).toBeGreaterThan(0);
  expect(positions.themeX).toBeLessThan(positions.logoutX);
  await account.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/perfil$/u);
  await expect(drawer).toBeHidden();
});
