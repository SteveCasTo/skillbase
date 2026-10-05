import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";
import { registerCourseInstructor } from "./instructor-helper";
import { e2eSiteUrl } from "../../scripts/e2e-port";
import {
  GROUP_SCHEDULE,
  planCourseDates,
} from "@/domain/courses/weekday-schedule";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import { createDatabase } from "@/server/db/client";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";

const headers = { Origin: e2eSiteUrl(), Accept: "application/json" };
async function fixture(
  page: Page,
  context: BrowserContext,
  studentAmount = "100",
  assignedInstructorId?: string,
) {
  const instructor = await registerCourseInstructor(page);
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const format = await page.request.post("/app/formatos/nuevo", {
    headers,
    form: {
      name: `Registration ${crypto.randomUUID()}`,
      totalHours: "20",
      sessionMinutes: "90",
      studentAmount,
      externalAmount: "150",
    },
  });
  expect(format.status()).toBe(201);
  const { id: courseTypeId } = (await format.json()) as { id: string };
  const planned = planCourseDates({
    startDate: "2027-05-03",
    weekdaysMask: 31,
    totalHours: 20,
    sessionMinutes: 90,
  });
  const name = `Registration ${crypto.randomUUID()}`;
  const created = await page.request.post("/app/cursos/nuevo", {
    headers,
    form: {
      name,
      description: "Synthetic registration flow",
      level: "BASIC",
      courseTypeId,
      instructorId: assignedInstructorId ?? instructor.id,
      schedule: GROUP_SCHEDULE,
      conditions: "Synthetic",
      requestKey: crypto.randomUUID(),
      startsAt: instantToBoliviaCivil(planned.startsAt),
      endsAt: instantToBoliviaCivil(planned.endsAt),
      weekdays: "1,2,3,4,5",
      minimumGrade: "70",
      registrationStartAt: instantToBoliviaCivil(
        new Date(Date.now() - 86_400_000),
      ),
      registrationEndAt: "2027-05-01T23:59",
    },
  });
  const createdPayload = await created.json();
  expect(created.status(), JSON.stringify(createdPayload)).toBe(201);
  const { id, revision } = createdPayload as {
    id: string;
    revision: string;
  };
  for (const startTime of ["18:00", "20:00"])
    expect(
      (
        await page.request.post(`/app/cursos/${id}/grupos`, {
          headers,
          form: { intent: "create", startTime, capacity: "5" },
        })
      ).status(),
    ).toBe(200);
  expect(
    (
      await page.request.post(`/app/cursos/${id}/editar`, {
        headers,
        form: { intent: "publish", revision },
      })
    ).status(),
  ).toBe(200);
  const groupResponse = await page.request.get(`/app/cursos/${id}/grupos`, {
    headers: { Accept: "application/json" },
  });
  const { groups } = (await groupResponse.json()) as {
    groups: { id: string }[];
  };
  return { id, groups, slug: name.toLowerCase().replace(" ", "-") };
}
async function fillPerson(page: Page) {
  const ci = `00-${crypto.randomUUID()}`;
  await page.getByLabel("CI", { exact: true }).fill(ci);
  await page.getByLabel("Nombre", { exact: true }).fill("Synthetic");
  await page.getByLabel("Apellidos", { exact: true }).fill("Registration");
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill(`registration-${crypto.randomUUID()}@test.invalid`);
  return ci;
}
test("ADMIN creates, edits global participant, transfers, cancels and records real cash without reload", async ({
  page,
  context,
}, testInfo) => {
  const f = await fixture(page, context);
  await page.goto(`/app/preinscripciones/nueva?courseId=${f.id}`);
  await expect(page.locator("#registration-create")).toHaveAttribute(
    "data-http-bound",
    "true",
  );
  const create = page.getByRole("button", {
    name: "Registrar preinscripción",
    exact: true,
  });
  await expect(create).toBeDisabled();
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 1280, height: 900 });
    const dark = await page
      .locator("html")
      .evaluate((element) => element.classList.contains("dark"));
    if (dark !== (theme === "dark"))
      await page
        .getByRole("button", { name: /Cambiar a modo/ })
        .filter({ visible: true })
        .click();
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`registration-form-${theme}-${width}.png`),
      });
    }
  }
  const personCi = await fillPerson(page);
  await page.getByRole("combobox", { name: "Grupo", exact: true }).click();
  await page.getByRole("option").first().click();
  await page.getByLabel("Efectivo recibido (Bs)").fill("25.50");
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page).toHaveURL(/\/app\/preinscripciones\/[0-9a-f-]+$/u);
  await expect(
    page.getByRole("region", { name: "Resumen financiero" }),
  ).toContainText("Bs 74,50");
  await page.evaluate(() => {
    (window as Window & { registrationMarker?: string }).registrationMarker =
      "kept";
  });
  const payment = page.locator("#registration-payment");
  const actions = page.getByRole("group", {
    name: "Acciones de preinscripción",
  });
  await actions
    .getByRole("button", { name: "Registrar abono", exact: true })
    .click();
  await expect(payment).toHaveAttribute("data-http-bound", "true");
  await payment.getByLabel("Importe (Bs)").fill("0.01");
  await payment
    .getByLabel("Motivo (opcional)", { exact: true })
    .fill("Segundo pago real");
  const receiptKey = await payment.locator('[name="requestKey"]').inputValue();
  const interrupted = "**/app/preinscripciones/*?operation=payment";
  await page.route(interrupted, async (route) => {
    expect((await route.fetch()).status()).toBe(200);
    await route.abort("failed");
    await page.unroute(interrupted);
  });
  await payment.getByRole("button", { name: "Registrar abono" }).click();
  await expect(payment.locator("[data-form-error]")).toContainText(
    "No se pudo confirmar",
  );
  await expect(payment.getByLabel("Importe (Bs)")).toHaveValue("0.01");
  await expect(payment.locator('[name="requestKey"]')).toHaveValue(receiptKey);
  await payment.getByRole("button", { name: "Registrar abono" }).click();
  await expect(
    page.getByRole("region", { name: "Resumen financiero" }),
  ).toContainText("Bs 74,49");
  expect(
    await page.evaluate(
      () =>
        (window as Window & { registrationMarker?: string }).registrationMarker,
    ),
  ).toBe("kept");
  const transfer = page.locator("#registration-transfer");
  await actions
    .getByRole("button", { name: "Cambiar de grupo", exact: true })
    .click();
  await transfer.getByRole("combobox", { name: "Grupo de destino" }).click();
  await page
    .getByRole("option")
    .filter({ hasNotText: "Selecciona" })
    .last()
    .click();
  await transfer.getByRole("button", { name: "Cambiar de grupo" }).click();
  await expect(page.locator("#registration-transfer")).toHaveAttribute(
    "data-http-bound",
    "true",
  );
  await page.getByRole("link", { name: "Datos del participante" }).click();
  await page
    .getByRole("button", { name: "Editar teléfono (opcional)", exact: true })
    .click();
  const phoneForm = page
    .locator("form")
    .filter({ has: page.getByLabel("Teléfono (opcional)", { exact: true }) });
  const phone = phoneForm.getByLabel("Teléfono (opcional)", { exact: true });
  await expect(
    phoneForm.getByRole("button", { name: "Guardar", exact: true }),
  ).toBeDisabled();
  await phone.fill("+591 70000000");
  await phoneForm.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Editar teléfono (opcional)",
      exact: true,
    }),
  ).toBeFocused();
  await expect(phone).toHaveValue("+591 70000000");
  await page.getByRole("link", { name: "Volver", exact: true }).click();
  const cancel = page.locator("#registration-cancel");
  await actions
    .getByRole("button", { name: "Cancelar preinscripción", exact: true })
    .click();
  await cancel
    .getByLabel("Motivo de cancelación")
    .fill("Cancelación solicitada");
  await cancel
    .getByRole("button", { name: "Cancelar preinscripción", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirmar cancelación" })
    .click();
  await expect(
    page.getByRole("region", { name: "Resumen financiero" }),
  ).toContainText("Devolución pendiente");
  const refund = page.locator("#registration-refund");
  await actions
    .getByRole("button", { name: "Registrar devolución", exact: true })
    .click();
  await expect(refund).toHaveAttribute("data-http-bound", "true");
  await refund.getByLabel("Importe (Bs)").fill("25.51");
  await refund.getByLabel("Motivo", { exact: true }).fill("Efectivo entregado");
  await refund.getByRole("button", { name: "Registrar devolución" }).click();
  await expect(
    page.getByRole("region", { name: "Resumen financiero" }),
  ).toContainText("Devuelto");
  await expect(
    page
      .getByRole("region", { name: "Historial de efectivo" })
      .getByText("Pago recibido", { exact: true }),
  ).toHaveCount(2);
  await expect(
    page
      .getByRole("region", { name: "Historial de efectivo" })
      .getByText("Devolución registrada", { exact: true }),
  ).toHaveCount(1);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto(`/app/preinscripciones?courseId=${f.id}`);
  await page.evaluate(() => {
    (window as Window & { registrationMarker?: string }).registrationMarker =
      "list-kept";
  });
  await page.getByLabel("Nombre o CI").fill(personCi);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("search"))
    .toBe(personCi);
  await expect(
    page.getByRole("link", { name: /Synthetic Registration/u }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { registrationMarker?: string }).registrationMarker,
    ),
  ).toBe("list-kept");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("link", { name: "CSV", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(
    /^preinscripciones-[\d-]+\.csv$/u,
  );
});
test("same-course interest prefill preserves demand and instructor roster exposes names only from official start", async ({
  page,
  context,
}) => {
  const database = createDatabase(getTestSupabaseEnvironment().databaseUrl);
  try {
    const [teacher] = await database.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, AUTH_FIXTURES.instructor.email));
    if (!teacher) throw new Error("Isolated instructor fixture missing");
    const f = await fixture(page, context, "100", teacher.id);
    const foreign = await fixture(page, context);
    const firstName = `Interesado ${crypto.randomUUID()}`;
    const email = `interest-${crypto.randomUUID()}@test.invalid`;
    const interested = await page.request.post(`/cursos/${f.slug}`, {
      headers,
      form: { firstName, lastName: "Prueba", email, phone: "" },
    });
    expect(interested.status()).toBe(200);
    await page.goto(`/app/preinscripciones/nueva?courseId=${f.id}`);
    await page.locator("#registration-person-search-query").fill(email);
    await expect(page.locator("[data-search-results]")).toContainText(email);
    await page
      .getByRole("button", {
        name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
      })
      .click();
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(
      firstName,
    );
    await expect(page.getByLabel("CI", { exact: true })).toHaveValue("");
    const ci = `00-${crypto.randomUUID()}`;
    await page.getByLabel("CI", { exact: true }).fill(ci);
    await page.getByRole("combobox", { name: "Grupo", exact: true }).click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Efectivo recibido (Bs)").fill("100");
    await page
      .getByRole("button", { name: "Registrar preinscripción", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/preinscripciones\/[0-9a-f-]+$/u);
    const interests = await database.db
      .select({ status: schema.interestRegistrations.status })
      .from(schema.interestRegistrations)
      .where(eq(schema.interestRegistrations.courseId, f.id));
    expect(interests).toEqual([{ status: "ACTIVE" }]);
    await signInFixture(context, AUTH_FIXTURES.instructor.email);
    const rosterUrl = `/app/mis-cursos/${f.id}/grupos/${f.groups[0]!.id}`;
    await page.goto(rosterUrl);
    await expect(
      page.getByRole("region", { name: "Participantes del grupo" }),
    ).toContainText("Disponible desde el inicio oficial");
    expect(await page.content()).not.toContain(ci);
    expect(await page.content()).not.toContain(email);
    // Build a separate historical fixture before attaching groups; never bypass
    // the calendar immutability guard on the already-published future course.
    const [original] = await database.db
      .select()
      .from(schema.courses)
      .where(eq(schema.courses.id, f.id));
    const [group] = await database.db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, f.groups[0]!.id));
    const [admin] = await database.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, AUTH_FIXTURES.admin.email));
    if (!original || !group || !admin)
      throw new Error("Isolated historical fixture source missing");
    const historical = planCourseDates({
      startDate: "2020-05-04",
      weekdaysMask: 31,
      totalHours: 20,
      sessionMinutes: 90,
    });
    const clock = new Date("2019-12-01T12:00:00.000Z");
    const [started] = await database.db
      .insert(schema.courses)
      .values({
        ...original,
        createActorId: null,
        createRequestKey: null,
        createFingerprint: null,
        id: crypto.randomUUID(),
        slug: `historical-${crypto.randomUUID()}`,
        startsAt: historical.startsAt,
        endsAt: historical.endsAt,
        registrationStartAt: null,
        registrationEndAt: null,
        createdAt: clock,
        updatedAt: clock,
      })
      .returning();
    const [startedGroup] = await database.db
      .insert(schema.groups)
      .values({
        ...group,
        id: crypto.randomUUID(),
        courseId: started!.id,
        startsAt: new Date("2020-05-04T22:00:00.000Z"),
        endsAt: new Date("2020-05-21T23:30:00.000Z"),
        createdAt: clock,
        updatedAt: clock,
        publishedAt: clock,
      })
      .returning();
    const seedRepository = createRegistrationRepository(
      database.db,
      () => clock,
    );
    const settings = await seedRepository.settings(admin.id);
    await seedRepository.create(
      {
        requestKey: crypto.randomUUID(),
        courseId: started!.id,
        courseRevision: started!.updatedAt.toISOString(),
        groupId: startedGroup!.id,
        settingsRevision: settings.revision,
        sourceInterestId: null,
        participantType: "STUDENT",
        firstDayException: false,
        participant: { ci, firstName, lastName: "Prueba", email, phone: null },
        initialPayment: {
          amountCents: 10000,
          effectiveDate: null,
          reason: "Historical cash fixture",
        },
      },
      admin.id,
    );
    await page.goto(
      `/app/mis-cursos/${started!.id}/grupos/${startedGroup!.id}`,
    );
    await expect(
      page.getByRole("region", { name: "Participantes del grupo" }),
    ).toContainText(`${firstName} Prueba`);
    expect(await page.content()).not.toContain(ci);
    expect(await page.content()).not.toContain(email);
    const foreignRoster = await page.request.get(
      `/app/mis-cursos/${foreign.id}/grupos/${foreign.groups[0]!.id}`,
    );
    expect(foreignRoster.status()).toBe(404);
  } finally {
    await database.close();
  }
});
test("SSR without JS supports a free registration without fake zero cash and exports remain private", async ({
  browser,
  page,
  context,
}) => {
  const f = await fixture(page, context, "0");
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: e2eSiteUrl(),
  });
  try {
    await signInFixture(noJs, AUTH_FIXTURES.admin.email);
    const html = await noJs.newPage();
    await html.goto(`/app/preinscripciones/nueva?courseId=${f.id}`);
    await fillPerson(html);
    await html.locator('select[name="groupId"]').selectOption(f.groups[0]!.id);
    expect(await html.locator('[name="amount"]').isDisabled()).toBe(true);
    await html
      .getByRole("button", { name: "Registrar preinscripción", exact: true })
      .click();
    await expect(html).toHaveURL(
      /\/app\/preinscripciones\/[0-9a-f-]+\?success=created$/u,
    );
    await expect(
      html.getByRole("region", { name: "Resumen financiero" }),
    ).toContainText("Gratuito");
    await expect(
      html.getByRole("region", { name: "Historial de efectivo" }),
    ).toContainText("No hay movimientos");
    const csv = await html.request.get(
      `/app/preinscripciones/exportar?format=CSV&courseId=${f.id}`,
    );
    expect(csv.status()).toBe(200);
    expect(csv.headers()["cache-control"]).toBe("private, no-store");
    expect(csv.headers()["x-content-type-options"]).toBe("nosniff");
    expect(csv.headers()["content-disposition"]).toMatch(
      /^attachment; filename="preinscripciones-[\d-]+\.csv"$/u,
    );
    const pdf = await html.request.get(
      `/app/preinscripciones/exportar?format=PDF&courseId=${f.id}`,
    );
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
  } finally {
    await noJs.close();
  }
  await signInFixture(context, AUTH_FIXTURES.instructor.email);
  await page.goto("/app");
  await expect(
    page.getByRole("link", { name: "Preinscripciones", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Configuración", exact: true }),
  ).toHaveCount(0);
  for (const path of [
    "/app/preinscripciones",
    "/app/participantes",
    "/app/configuracion",
    "/app/preinscripciones/buscar?search=00",
    "/app/preinscripciones/exportar?format=CSV",
  ])
    expect((await page.request.get(path, { maxRedirects: 0 })).status()).toBe(
      303,
    );
});
