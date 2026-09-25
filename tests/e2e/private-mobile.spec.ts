import { expect, test } from "@playwright/test";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test("mobile private navigation exposes authorized multi-role destinations", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.mobileMultiRole.email);
  await page.goto("/app");
  const triggerBox = await page.getByLabel("Abrir menú").boundingBox();
  const brandBox = await page.locator(".private-mobile-header a").boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(brandBox).not.toBeNull();
  expect(triggerBox!.x).toBeLessThan(brandBox!.x);
  await page.getByLabel("Abrir menú").click();
  const navigation = page.getByRole("navigation", { name: "Navegación móvil" });
  await expect(page.getByRole("dialog", { name: "SkillBase" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Cursos" })).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Formatos" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Asistencia" }),
  ).toBeVisible();
  await navigation.getByRole("link", { name: "Asistencia" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Asistencia" }),
  ).toBeVisible();
});

test("mobile drawer closes with Escape and restores keyboard focus", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto("/app");
  const trigger = page.getByRole("button", { name: "Abrir menú" });
  await trigger.click();
  const navigation = page.getByRole("navigation", { name: "Navegación móvil" });
  await expect(
    navigation.getByRole("link", { name: "Asistencia" }),
  ).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Cursos" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});
