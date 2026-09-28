import { expect, test } from "@playwright/test";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test.use({ javaScriptEnabled: false });

test("cancellation requires explicit HTML confirmation without JavaScript", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const headers = {
    Origin: "http://127.0.0.1:4321",
    Accept: "application/json",
  };
  const format = await page.request.post("/app/formatos/nuevo", {
    headers,
    form: {
      name: `Formato no JS ${Date.now()}`,
      totalHours: "20",
      sessionMinutes: "90",
      studentAmount: "80",
      externalAmount: "100",
    },
  });
  const { id: courseTypeId } = (await format.json()) as { id: string };
  const course = await page.request.post("/app/cursos/nuevo", {
    headers,
    form: {
      name: `Grupos no JS ${Date.now()}`,
      description: "Curso de prueba sin JavaScript.",
      level: "BASIC",
      courseTypeId,
      schedule: "Lunes a viernes, 08:00–09:30",
      conditions: "Cupo limitado.",
      startsAt: "2027-03-01T08:00",
      endsAt: "2027-03-17T09:30",
      registrationStartAt: "2027-01-01T08:00",
      registrationEndAt: "2027-02-20T18:00",
      weekdays: "1,2,3,4,5",
      minimumGrade: "70",
    },
  });
  expect(course.status()).toBe(201);
  const { id } = (await course.json()) as { id: string };
  await page.request.post(`/app/cursos/${id}/editar`, {
    headers,
    form: { intent: "publish" },
  });
  await page.goto(`/app/cursos/${id}/grupos`);
  const invalidResponse = await page.request.post(`/app/cursos/${id}/grupos`, {
    headers: { Origin: "http://127.0.0.1:4321", Accept: "text/html" },
    form: { intent: "create", startTime: "08:00", capacity: "0" },
  });
  expect(invalidResponse.status()).toBe(422);
  await page.setContent(await invalidResponse.text());
  const invalidCapacity = page
    .getByRole("form", { name: "Nuevo grupo" })
    .getByLabel("Capacidad");
  await expect(invalidCapacity).toHaveAttribute("aria-invalid", "true");
  await expect(invalidCapacity).toHaveAttribute(
    "aria-describedby",
    "new-capacity-error",
  );
  await expect(page.locator("#new-capacity-error")).toContainText(
    "La capacidad debe ser un entero positivo",
  );
  await page.goto(`/app/cursos/${id}/grupos`);
  const form = page.getByRole("form", { name: "Nuevo grupo" });
  await page.locator("[data-new-fallback] summary").click();
  await form.getByLabel("Hora de inicio").fill("08:00");
  await form.getByLabel("Capacidad").fill("15");
  await form.getByRole("button", { name: "Crear grupo" }).click();
  await expect(page).toHaveURL(/success=created/);
  await page.goto(`/app/cursos/${id}/editar`);
  await expect(page.getByLabel("Horario planificado histórico")).toHaveValue(
    "Lunes a viernes, 08:00–09:30",
  );
  await expect(
    page.getByLabel("Inicio del curso (AAAA-MM-DDTHH:mm)"),
  ).toHaveValue("2027-03-01T08:00");
  await expect(page.locator('[name="registrationStartDate"]')).toHaveCount(0);
  await expect(page.locator('[name="registrationEndDate"]')).toHaveCount(0);
  await expect(page.locator('[name="registrationStartAt"]')).toHaveValue(
    "2027-01-01T08:00",
  );
  await expect(page.locator('[name="registrationEndAt"]')).toHaveValue(
    "2027-02-20T18:00",
  );
  await page
    .getByLabel("Descripción")
    .fill("Curso histórico con grupo editado sin JavaScript.");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page).toHaveURL(/success=updated/);
  await page.goto(`/app/cursos/${id}/editar`);
  await expect(page.getByLabel("Descripción")).toHaveValue(
    "Curso histórico con grupo editado sin JavaScript.",
  );
  await expect(page.getByLabel("Horario planificado histórico")).toHaveValue(
    "Lunes a viernes, 08:00–09:30",
  );
  await expect(
    page.getByLabel("Inicio del curso (AAAA-MM-DDTHH:mm)"),
  ).toHaveValue("2027-03-01T08:00");
  await expect(page.locator('[name="registrationStartAt"]')).toHaveValue(
    "2027-01-01T08:00",
  );
  await expect(page.locator('[name="registrationEndAt"]')).toHaveValue(
    "2027-02-20T18:00",
  );
  await page.goto(`/app/cursos/${id}/grupos`);
  await page.locator("[data-action-fallback] summary").click();
  await expect(
    page.getByRole("button", { name: "Sí, desactivar grupo" }),
  ).toBeVisible();
  await page.locator("[data-action-fallback] summary").click();
  await expect(
    page.getByRole("button", { name: "Sí, desactivar grupo" }),
  ).toBeHidden();
  await page.locator("[data-action-fallback] summary").click();
  await page.getByRole("button", { name: "Sí, desactivar grupo" }).click();
  await expect(page).toHaveURL(/success=cancelled/);
  await expect(page.getByText("Inactivo", { exact: true })).toBeVisible();
});
