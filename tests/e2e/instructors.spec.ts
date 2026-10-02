import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";
import { createDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

test("ADMIN creates and edits a registered instructor with a semantic full-card link on mobile", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app/instructores");
  await page.getByRole("link", { name: "Crear instructor" }).click();
  await expect(page).toHaveURL(/\/app\/instructores\/nuevo$/u);
  await expect(page.locator("[data-instructor-form]")).toHaveAttribute(
    "data-bound",
    "true",
  );
  const name = `Instructor ${randomUUID()}`;
  const email = `instructor-${randomUUID()}@e2e.test`;
  const password = randomBytes(24).toString("base64url");
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Apellidos").fill("Sintético");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña inicial").fill(password);
  await page.getByRole("button", { name: "Crear instructor" }).click();
  await expect(page).toHaveURL(
    /\/app\/instructores\/[0-9a-f-]+\/editar\?success=saved$/u,
  );
  await expect(
    page.getByText("Instructor guardado correctamente."),
  ).toBeVisible();
  expect(await page.content()).not.toContain(password);
  await expect(page.locator("[data-instructor-form]")).toHaveAttribute(
    "data-bound",
    "true",
  );
  await page.getByLabel("Teléfono (opcional)").fill("+591 70000000");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/app\/instructores\/[0-9a-f-]+\/editar$/u.test(
        new URL(response.url()).pathname,
      ),
  );
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(page.getByLabel("Teléfono (opcional)")).toHaveValue(
    "+591 70000000",
  );
  await page.goto("/app/instructores");
  const card = page.getByRole("link", {
    name: `${name} Sintético ${email} Cuenta activa`,
  });
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Editar instructor" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("instructor sees only own courses/groups and every foreign URL and mutation remains denied", async ({
  context,
  page,
}) => {
  const database = createDatabase(getTestSupabaseEnvironment().databaseUrl);
  let owned = "";
  let foreign = "";
  try {
    const [teacher] = await database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, AUTH_FIXTURES.instructor.email));
    if (!teacher) throw new Error("Instructor fixture missing");
    const [format] = await database.db
      .insert(schema.courseTypes)
      .values({ name: `Instructor view ${randomUUID()}` })
      .returning();
    const [revision] = await database.db
      .insert(schema.courseTypeRevisions)
      .values({
        courseTypeId: format!.id,
        revisionNumber: 1,
        totalHours: 3,
        sessionMinutes: 90,
        studentAmount: "10",
        externalAmount: "20",
      })
      .returning();
    for (const own of [true, false]) {
      const [course] = await database.db
        .insert(schema.courses)
        .values({
          name: own ? "Mi curso sintético" : "Curso ajeno sintético",
          slug: `instructor-view-${randomUUID()}`,
          description: "Consulta privada sintética",
          level: "BASIC",
          courseTypeRevisionId: revision!.id,
          instructorId: own ? teacher.id : null,
          startsAt: new Date("2027-09-01T04:00Z"),
          endsAt: new Date("2027-09-03T03:59Z"),
          schedule: "Horario por grupo",
          conditions: "Sintético",
          minimumGrade: 70,
        })
        .returning();
      if (own) owned = course!.id;
      else foreign = course!.id;
      await database.db.insert(schema.groups).values({
        courseId: course!.id,
        courseTypeRevisionId: revision!.id,
        capacity: 20,
        startsAt: new Date("2027-09-01T12:00Z"),
        endsAt: new Date("2027-09-02T13:30Z"),
      });
    }
  } finally {
    await database.close();
  }
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto("/app/mis-cursos");
  await expect(
    page.getByRole("link", { name: /Mi curso sintético/u }),
  ).toBeVisible();
  await expect(page.getByText("Curso ajeno sintético")).toHaveCount(0);
  await page.goto(`/app/mis-cursos/${owned}`);
  await expect(
    page.getByRole("heading", { name: "Grupos", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Grupo 1", exact: true }),
  ).toBeVisible();
  const denied = await page.goto(`/app/mis-cursos/${foreign}`);
  expect(denied?.status()).toBe(404);
  await expect(page.getByText("Curso ajeno sintético")).toHaveCount(0);
  for (const route of [
    "/app/instructores",
    "/app/formatos",
    "/app/interesados",
    `/app/cursos/${owned}/editar`,
    `/app/cursos/${owned}/grupos`,
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/unauthorized\?reason=forbidden$/u);
  }
  expect(
    (
      await page.request.post(`/app/mis-cursos/${owned}`, {
        headers: { Origin: new URL(page.url()).origin },
        form: { intent: "update" },
      })
    ).status(),
  ).toBe(405);
  await page.goto("/app/perfil");
  await expect(
    page.getByRole("heading", { name: "Perfil profesional" }),
  ).toBeVisible();
});

test("instructor creation and validation work without JavaScript and never echo the password", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    const page = await context.newPage();
    await page.goto("/app/instructores/nuevo");
    const password = randomBytes(24).toString("base64url");
    const invalid = await page.request.post("/app/instructores/nuevo", {
      headers: { Origin: new URL(page.url()).origin },
      form: {
        firstName: " ",
        lastName: "Synthetic",
        email: `nojs-${randomUUID()}@e2e.test`,
        password,
      },
    });
    expect(invalid.status()).toBe(422);
    expect(await invalid.text()).not.toContain(password);
    await page.getByLabel("Nombre", { exact: true }).fill("Sin JavaScript");
    await page.getByLabel("Apellidos").fill("Sintético");
    await page
      .getByLabel("Correo electrónico")
      .fill(`nojs-${randomUUID()}@e2e.test`);
    await page.getByLabel("Contraseña inicial").fill(password);
    await page.getByRole("button", { name: "Crear instructor" }).click();
    await expect(page).toHaveURL(
      /\/app\/instructores\/[0-9a-f-]+\/editar\?success=saved$/u,
    );
    await expect(
      page.getByText("Instructor guardado correctamente."),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
