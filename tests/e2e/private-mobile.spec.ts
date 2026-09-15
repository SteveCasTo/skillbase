import { expect, test } from "@playwright/test";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test("mobile private navigation exposes authorized multi-role destinations", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.mobileMultiRole.email);
  await page.goto("/app");
  await page.getByLabel("Abrir menú").click();
  const navigation = page.getByRole("navigation", { name: "Navegación móvil" });
  await expect(navigation.getByRole("link", { name: "Cursos" })).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Asistencia" }),
  ).toBeVisible();
  await navigation.getByRole("link", { name: "Asistencia" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Asistencia" }),
  ).toBeVisible();
});
