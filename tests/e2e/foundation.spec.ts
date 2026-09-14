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
  await page.getByRole("button", { name: "Oscuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
