import { expect, test } from "@playwright/test";

test("renders the foundation and persists a theme preference", async ({
  page,
}) => {
  await page.goto("/?preview=courses");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "El siguiente paso es tuyo.",
  );
  await expect(
    page.getByRole("link", { name: "Explorar cursos" }),
  ).toHaveAttribute("href", "#cursos");
  await expect(
    page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Acceso del equipo" }),
  ).toHaveAttribute("href", "/login");
  await page.waitForFunction(
    () =>
      !document
        .querySelector("astro-island:has([data-theme-toggle])")
        ?.hasAttribute("ssr"),
  );
  await expect(
    page.getByRole("button", { name: "Cambiar a modo oscuro" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cambiar a modo oscuro" }).click();
  await expect(
    page.getByRole("button", { name: "Cambiar a modo claro" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Cambiar a modo claro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(
    page.getByRole("button", { name: "Cambiar a modo del sistema" }),
  ).toHaveCount(0);
});
