import { expect, test } from "@playwright/test";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

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
  const form = page.locator("[data-instructor-form]");
  await expect(form).toHaveAttribute("data-bound", "true");
  const submit = form.getByRole("button", {
    name: "Guardar cambios",
    exact: true,
  });
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
  await expect(
    form.getByText(
      "El correo de acceso se conserva para mantener la identidad de la cuenta.",
    ),
  ).toHaveCount(0);
  await expect(form.getByLabel("Correo electrónico")).toHaveAttribute(
    "readonly",
    "",
  );
});

test("instructor and profile layouts fill available width without horizontal overflow", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto("/app/perfil");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const form = page.locator("[data-instructor-form]");
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
