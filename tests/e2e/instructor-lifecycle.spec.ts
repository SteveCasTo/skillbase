import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  authAttemptBuckets,
  courseTypes,
  courseTypeRevisions,
  courses,
} from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test("instructor lifecycle confirmation and mutations remain available without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    const page = await context.newPage();
    await page.goto("/app/instructores/nuevo");
    await page.getByLabel("Nombre", { exact: true }).fill("Fallback");
    await page.getByLabel("Apellidos").fill("Sintético");
    await page
      .getByLabel("Correo electrónico")
      .fill(`fallback-lifecycle-${randomUUID()}@e2e.test`);
    await page
      .getByLabel("Contraseña inicial", { exact: true })
      .fill(randomBytes(24).toString("base64url"));
    await page
      .getByRole("button", { name: "Crear instructor", exact: true })
      .click();
    await expect(page).toHaveURL(/\/editar\?success=saved$/u);
    const panel = page.locator("[data-instructor-lifecycle]");
    await expect(
      panel.getByText("Desactivar instructor", { exact: true }),
    ).toBeHidden();
    await panel
      .locator("summary")
      .filter({ hasText: /^Eliminar instructor$/u })
      .click();
    await panel
      .getByRole("button", {
        name: "Eliminar instructor",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/app\/instructores\?success=deleted$/u);
  } finally {
    await context.close();
  }
});

test("ADMIN lifecycle preserves credentials on reactivation and denies existing sessions for accounts with history", async ({
  context,
  page,
  browser,
}) => {
  // Each scenario owns its rate-limit fixture. Earlier login/recovery scenarios must
  // not spend this scenario's network budget; account limits and runtime guards stay unchanged.
  const secret = process.env.AUTH_RATE_LIMIT_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Isolated Auth fixture configuration unavailable");
  const networkKey = createHmac("sha256", secret)
    .update("network:127.0.0.1:login")
    .digest("hex");
  const database = createDatabase(getTestSupabaseEnvironment().databaseUrl);
  try {
    await database.db
      .delete(authAttemptBuckets)
      .where(eq(authAttemptBuckets.key, networkKey));
  } finally {
    await database.close();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/instructores/nuevo");
  const email = `lifecycle-${randomUUID()}@e2e.test`;
  const password = randomBytes(24).toString("base64url");
  await page.getByLabel("Nombre", { exact: true }).fill("Lifecycle");
  await page.getByLabel("Apellidos").fill("Sintético");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña inicial", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Crear instructor", exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/app\/instructores\/[0-9a-f-]+\/editar\?success=saved$/u,
  );
  const endpoint = new URL(page.url()).pathname;
  // An assigned course blocks deactivation; an archived one preserves history.
  const history = createDatabase(getTestSupabaseEnvironment().databaseUrl);
  let blockingCourseId: string;
  try {
    const [format] = await history.db
      .insert(courseTypes)
      .values({ name: `Lifecycle ${randomUUID()}` })
      .returning();
    const [revision] = await history.db
      .insert(courseTypeRevisions)
      .values({
        courseTypeId: format!.id,
        revisionNumber: 1,
        totalHours: 3,
        sessionMinutes: 90,
        studentAmount: "10",
        externalAmount: "20",
      })
      .returning();
    const [course] = await history.db
      .insert(courses)
      .values({
        name: "Curso asignado sintético",
        slug: `lifecycle-${randomUUID()}`,
        description: "Fixture privado",
        level: "BASIC",
        courseTypeRevisionId: revision!.id,
        instructorId: endpoint.split("/")[3]!,
        startsAt: new Date("2027-09-01T04:00Z"),
        endsAt: new Date("2027-09-03T03:59Z"),
        schedule: "Horario sintético",
        conditions: "Fixture",
        minimumGrade: 70,
      })
      .returning();
    blockingCourseId = course!.id;
  } finally {
    await history.close();
  }
  await page.reload();
  const blocked = page.locator("[data-instructor-lifecycle]");
  await expect(
    blocked.locator("summary").filter({ hasText: /^Desactivar instructor$/u }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    blocked.getByRole("link", {
      name: "Curso asignado sintético",
      exact: true,
    }),
  ).toHaveAttribute("href", `/app/cursos/${blockingCourseId}/editar`);
  const denied = await page.request.post(endpoint, {
    headers: { Origin: new URL(page.url()).origin, Accept: "application/json" },
    form: {
      intent: "deactivate",
      revision: await blocked
        .locator(
          'form[data-lifecycle-form]:has(input[name="intent"][value="deactivate"]) input[name="revision"]',
        )
        .inputValue(),
    },
  });
  expect(denied.status()).toBe(422);
  const archive = createDatabase(getTestSupabaseEnvironment().databaseUrl);
  try {
    await archive.db
      .update(courses)
      .set({ status: "ARCHIVED" })
      .where(eq(courses.id, blockingCourseId));
  } finally {
    await archive.close();
  }
  await page.reload();
  const instructorContext = await browser.newContext();
  try {
    const instructor = await instructorContext.newPage();
    await instructor.goto("/login");
    await instructor
      .getByLabel("Correo electrónico", { exact: true })
      .fill(email);
    await instructor.getByLabel("Contraseña", { exact: true }).fill(password);
    await instructor
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await expect(instructor).toHaveURL(/\/app$/u);
    const panel = page.locator("[data-instructor-lifecycle]");
    await expect(panel).toHaveAttribute("data-ready", "true");
    await expect(
      panel.getByText("Eliminar instructor", { exact: true }),
    ).toBeHidden();
    const deactivate = panel
      .locator("summary")
      .filter({ hasText: /^Desactivar instructor$/u });
    await deactivate.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Desactivar instructor" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(deactivate).toBeFocused();
    await deactivate.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Desactivar instructor", exact: true })
      .click();
    await expect(page).toHaveURL(
      `${new URL(page.url()).origin}${endpoint}?success=deactivate`,
    );
    await expect(
      panel.getByText("Cuenta desactivada", { exact: true }),
    ).toBeVisible();
    await instructor.goto("/app/perfil");
    await expect(instructor).toHaveURL(/\/unauthorized\?reason=disabled$/u);
    // A fresh password login is a separate assertion from the existing-session denial above.
    await instructorContext.clearCookies();
    await panel
      .locator("summary")
      .filter({ hasText: /^Activar instructor$/u })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Activar instructor", exact: true })
      .click();
    await expect(page).toHaveURL(
      `${new URL(page.url()).origin}${endpoint}?success=activate`,
    );
    await instructor.goto("/login");
    await instructor
      .getByLabel("Correo electrónico", { exact: true })
      .fill(email);
    await instructor.getByLabel("Contraseña", { exact: true }).fill(password);
    await instructor
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await expect(instructor).toHaveURL(/\/app$/u);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await instructorContext.close();
  }
});

test("instructor lifecycle preserves inline error and shows pending feedback without submitting twice", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/instructores/nuevo");
  await page.getByLabel("Nombre", { exact: true }).fill("Pending");
  await page.getByLabel("Apellidos").fill("Sintético");
  await page
    .getByLabel("Correo electrónico")
    .fill(`pending-${randomUUID()}@e2e.test`);
  await page
    .getByLabel("Contraseña inicial", { exact: true })
    .fill(randomBytes(24).toString("base64url"));
  await page
    .getByRole("button", { name: "Crear instructor", exact: true })
    .click();
  await expect(page).toHaveURL(/\/editar\?success=saved$/u);
  const panel = page.locator("[data-instructor-lifecycle]");
  await expect(panel).toHaveAttribute("data-ready", "true");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/app/instructores/*/editar", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests++;
    await gate;
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: "El perfil cambió. Recarga antes de continuar.",
      }),
    });
  });
  await panel
    .locator("summary")
    .filter({ hasText: /^Eliminar instructor$/u })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Eliminar instructor", exact: true })
    .click();
  await expect(panel).toHaveAttribute("aria-busy", "true");
  release();
  await expect(panel.locator("[data-lifecycle-error]")).toHaveText(
    "El perfil cambió. Recarga antes de continuar.",
  );
  await expect(panel.locator("[data-lifecycle-error]")).toBeFocused();
  await expect(panel).not.toHaveAttribute("aria-busy", "true");
  expect(requests).toBe(1);
});
