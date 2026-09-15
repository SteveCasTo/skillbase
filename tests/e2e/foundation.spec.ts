import { expect, test } from "@playwright/test";

test("renders the foundation and persists a theme preference", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Formación continua",
  );
  await expect(
    page.getByRole("link", { name: "Ver la base técnica" }),
  ).toHaveAttribute("data-slot", "button");
  await expect(
    page.getByRole("link", { name: "Acceso del equipo" }),
  ).toHaveAttribute("href", "/login");
  const darkTheme = page.getByRole("button", { name: "Oscuro" });
  await expect(async () => {
    await darkTheme.click();
    await expect(darkTheme).toHaveAttribute("aria-pressed", "true");
  }).toPass();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
