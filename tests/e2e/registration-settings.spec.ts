import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { registrationSettings } from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

async function withIsolatedSettings(
  action: (
    snapshot: {
      minimumPaymentPercent: number;
      auxiliaryDiscountPercent: number;
      revision: number;
    } | null,
  ) => Promise<void>,
): Promise<void> {
  const database = createDatabase(getTestSupabaseEnvironment().databaseUrl);
  const [row] = await database.db
    .select({
      minimumPaymentPercent: registrationSettings.minimumPaymentPercent,
      auxiliaryDiscountPercent: registrationSettings.auxiliaryDiscountPercent,
      revision: registrationSettings.revision,
    })
    .from(registrationSettings)
    .where(eq(registrationSettings.id, 1));
  const snapshot = row ?? null;
  try {
    await action(snapshot);
  } finally {
    if (snapshot) {
      await database.db
        .update(registrationSettings)
        .set({
          minimumPaymentPercent: snapshot.minimumPaymentPercent,
          auxiliaryDiscountPercent: snapshot.auxiliaryDiscountPercent,
        })
        .where(eq(registrationSettings.id, 1));
    } else {
      await database.db
        .delete(registrationSettings)
        .where(eq(registrationSettings.id, 1));
    }
    await database.close();
  }
}

test("ADMIN settings save stays in place, reports conflicts, and restores only the test setting row", async ({
  context,
  page,
}) => {
  await withIsolatedSettings(async (snapshot) => {
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    await page.goto("/app/configuracion");
    const form = page.locator("[data-registration-settings-form]");
    await expect(form).toHaveJSProperty("noValidate", true);
    const minimum = form.getByLabel("Pago mínimo para confirmar inscripción");
    const auxiliary = form.getByLabel("Descuento para auxiliares elegibles");
    const savedMinimum = await minimum.inputValue();
    const savedAuxiliary = await auxiliary.inputValue();
    expect(savedMinimum).toBe(String(snapshot?.minimumPaymentPercent ?? 25));
    expect(savedAuxiliary).toBe(
      String(snapshot?.auxiliaryDiscountPercent ?? 50),
    );
    const revision = await form.locator('[name="revision"]').inputValue();
    const nextAuxiliary = savedAuxiliary === "100" ? "99" : "100";
    await auxiliary.fill(nextAuxiliary);
    const submit = form.getByRole("button", {
      name: "Guardar configuración",
      exact: true,
    });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(auxiliary).toHaveValue(nextAuxiliary);
    await expect(submit).toBeDisabled();
    await expect(
      page.getByText("Configuración guardada.", { exact: true }),
    ).toBeVisible();

    const response = await page.request.post("/app/configuracion", {
      headers: {
        Accept: "application/json",
        Origin: new URL(page.url()).origin,
      },
      form: {
        requestKey: randomUUID(),
        revision,
        minimumPaymentPercent: savedMinimum,
        auxiliaryDiscountPercent: savedAuxiliary,
      },
    });
    expect(response.status()).toBe(409);
    const conflict = (await response.json()) as {
      code: string;
      fields: Record<string, string>;
    };
    expect(conflict).toMatchObject({ code: "CONCURRENT_UPDATE", fields: {} });
    await expect(auxiliary).toHaveValue(nextAuxiliary);
    await expect(form.locator('[name="revision"]')).not.toHaveValue(revision);
  });
});

test("settings POST remains usable without JavaScript and preserves the starting configuration", async ({
  browser,
}) => {
  await withIsolatedSettings(async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      await signInFixture(context, AUTH_FIXTURES.admin.email);
      const page = await context.newPage();
      await page.goto("/app/configuracion");
      const form = page.locator("[data-registration-settings-form]");
      const auxiliary = form.getByLabel("Descuento para auxiliares elegibles");
      const next = (Number(await auxiliary.inputValue()) + 1) % 101;
      await auxiliary.fill(String(next));
      await form.getByRole("button", { name: "Guardar configuración" }).click();
      await expect(page).toHaveURL(/\/app\/configuracion\?success=saved$/u);
      await expect(
        page.getByText("Configuración guardada.", { exact: true }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
