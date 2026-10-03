import { expect, test } from "@playwright/test";

test("password validation before hydration preserves input and matching ARIA without React warnings", async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (
      ["error", "warning"].includes(message.type()) &&
      /hydrat|read-only|onChange/iu.test(message.text())
    )
      warnings.push(message.text());
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/src/components/auth/PasswordField.tsx*",
    async (route) => {
      await gate;
      await route.continue();
    },
  );
  try {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const password = page.getByLabel("Contraseña", { exact: true });
    const toggle = page.getByRole("button", {
      name: "Mostrar contraseña",
      exact: true,
    });
    await expect(toggle).toBeDisabled();
    await password.fill("SyntheticHydrationPassword");
    await page.getByLabel("Correo electrónico", { exact: true }).focus();
    await expect(password).toHaveAttribute("aria-invalid", "false");
    release();
    await expect(toggle).toBeEnabled();
    await expect(password).toHaveValue("SyntheticHydrationPassword");
    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("SyntheticHydrationPassword");
    expect(warnings).toEqual([]);
  } finally {
    release();
  }
});
