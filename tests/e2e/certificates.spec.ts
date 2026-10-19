import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createAttendanceFlowFixture } from "../fixtures/attendance-flow";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";
import { e2eSiteUrl } from "../../scripts/e2e-port";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { ClosureStateDto } from "@/domain/academic-closure/types";
import type { CertificateDto } from "@/domain/certificates/types";
import { courses } from "@/server/db/schema";

test.setTimeout(120_000);
const headers = { Accept: "application/json", Origin: e2eSiteUrl() };
type Fixture = Awaited<ReturnType<typeof createAttendanceFlowFixture>>;
const groupPath = (fixture: Fixture) =>
  `/app/cursos/${fixture.historyCourseId}/grupos/${fixture.historyGroupId}`;
async function state(page: Page, fixture: Fixture) {
  const response = await page.request.get(`${groupPath(fixture)}/cierre`, {
    headers,
  });
  expect(response.status()).toBe(200);
  const result: { available: boolean; data: ClosureStateDto } =
    await response.json();
  expect(result.available).toBe(true);
  return result.data;
}
async function closeOfficialGroup(page: Page, fixture: Fixture) {
  const component = {
    id: crypto.randomUUID(),
    name: "Evaluación sintética QA",
    type: "THEORY",
    weight: "100.00",
  };
  const scheme = await page.request.post(
    `/app/cursos/${fixture.historyCourseId}/evaluaciones`,
    {
      headers,
      data: {
        requestKey: crypto.randomUUID(),
        schemeRevision: 0,
        components: [component],
      },
    },
  );
  expect(scheme.status()).toBe(200);
  const before = await state(page, fixture);
  const person = before.provisional!.participants.find(
    (entry) => entry.registrationId === fixture.historyPaid.id,
  )!;
  const grades = await page.request.post(`${groupPath(fixture)}/evaluaciones`, {
    headers,
    data: {
      requestKey: crypto.randomUUID(),
      schemeRevision: 1,
      registrationId: person.registrationId,
      grades: [{ componentId: component.id, gradeRevision: 0, score: "80.00" }],
    },
  });
  expect(grades.status()).toBe(200);
  for (const session of before.provisional!.sessions) {
    const marked = await page.request.post(
      `${groupPath(fixture)}/sesiones/${session.id}?operation=record`,
      {
        headers,
        data: {
          requestKey: crypto.randomUUID(),
          revision: session.revision,
          marks: [{ registrationId: person.registrationId, status: "PRESENT" }],
          instructorStatus: "PRESENT",
          ...(session.administrativeReviewRequired
            ? {
                reviewRegistrationIds: [person.registrationId],
                completeAdministrativeReview: true,
              }
            : {}),
        },
      },
    );
    expect(marked.status()).toBe(200);
  }
  const ready = await state(page, fixture);
  expect(ready.canClose).toBe(true);
  const response = await page.request.post(
    `${groupPath(fixture)}/cierre?operation=close`,
    {
      headers,
      data: { requestKey: crypto.randomUUID(), revision: ready.revision },
    },
  );
  expect(response.status()).toBe(200);
  return state(page, fixture);
}
async function settings(page: Page, fixtureKey: string) {
  await page.goto("/app/configuracion/certificados");
  await expect(page).toHaveURL(/\/app\/configuracion#firmantes$/);
  for (const [id, name] of [
    ["departmentHead.name", `Jefatura ficticia QA ${fixtureKey}`],
    ["director.name", `Dirección ficticia QA ${fixtureKey}`],
    ["dean.name", `Decanato ficticio QA ${fixtureKey}`],
  ]) {
    const form = page.locator(
      `[data-certificate-settings-field][data-edit-field="${id}"]`,
    );
    await form
      .getByRole("button", { name: "Editar nombre completo", exact: true })
      .click();
    await form.locator(`[id="${id}"]`).fill(name!);
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/app/configuracion/certificados",
    );
    await form
      .getByRole("button", { name: "Guardar nombre completo", exact: true })
      .click();
    expect((await saved).status()).toBe(200);
    await expect(form.locator("[data-inline-value]")).toHaveText(name!);
  }
  const draft = page.locator(
    '[data-edit-field="director.name"][data-certificate-settings-field]',
  );
  await draft
    .getByRole("button", { name: "Editar nombre completo", exact: true })
    .click();
  await draft.locator('input[name="value"]').fill("Borrador sin guardar QA");
  for (const label of [
    "Previsualizar aprobación",
    "Previsualizar instructor",
  ]) {
    const pdf = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/vista-previa.pdf"),
    );
    await page.getByRole("button", { name: label, exact: true }).click();
    expect((await pdf).status()).toBe(200);
    await expect(page.getByRole("dialog").locator("iframe")).toBeVisible();
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(draft.locator('input[name="value"]')).toHaveValue(
      "Borrador sin guardar QA",
    );
  }
  await draft
    .getByRole("button", {
      name: "Cancelar edición de nombre completo",
      exact: true,
    })
    .click();
}
async function records(
  page: Page,
  fixture: Fixture,
): Promise<CertificateDto[]> {
  // Reads actual SSR detail adapters, not direct Storage or mocked HTTP success.
  const hrefs = await page
    .locator('a[href^="/app/certificados/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
  const result: CertificateDto[] = [];
  for (const href of [...new Set(hrefs)].filter((href) =>
    /^\/app\/certificados\/[0-9a-f-]{36}$/u.test(href),
  )) {
    const response = await page.request.get(href, { headers });
    expect(response.status()).toBe(200);
    const loaded: { available: boolean; data: CertificateDto } =
      await response.json();
    expect(loaded.available).toBe(true);
    if (loaded.data.groupId === fixture.historyGroupId)
      result.push(loaded.data);
  }
  return result;
}
async function generate(
  page: Page,
  fixture: Fixture,
  type: "APPROVAL" | "INSTRUCTOR" = "APPROVAL",
) {
  await page.goto(`${groupPath(fixture)}/certificados`);
  const section = page.locator(`section[aria-labelledby="recipients-${type}"]`);
  await section.getByRole("link").first().click();
  const form = page.locator("form[data-certificate-form]");
  await expect(
    form.getByRole("button", { name: "Generar PDF", exact: true }),
  ).toBeEnabled();
  const generated = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.includes(
        `/certificados/${type.toLowerCase()}/`,
      ),
  );
  await form.getByRole("button", { name: "Generar PDF", exact: true }).click();
  expect((await generated).status()).toBe(200);
  await expect(page).toHaveURL(/\/app\/certificados\/[0-9a-f-]{36}$/u);
  const response = await page.request.get(new URL(page.url()).pathname, {
    headers,
  });
  const loaded: { available: boolean; data: CertificateDto } =
    await response.json();
  expect(loaded.available).toBe(true);
  return loaded.data;
}
async function signedFixture(
  notice = "SYNTHETIC QA: lifecycle upload evidence only",
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(
    "SYNTHETIC QA uploaded PDF — not institutional handwritten signatures",
  );
  pdf.addPage().drawText(notice);
  return Buffer.from(await pdf.save());
}
async function checkDownloadFeedback(
  page: Page,
  signed: boolean,
  info: TestInfo,
) {
  const control = page.getByRole(signed ? "link" : "button", {
    name: signed ? "Descargar firmado" : "Descargar para firmar",
    exact: true,
  });
  const endpoint = `**/app/certificados/*/${signed ? "firmado" : "generado"}.pdf`;
  const toast = page.locator('[data-sileo-toast][data-exiting="false"]');
  let release: (() => void) | undefined;
  let calls = 0;
  let received: Buffer | undefined;
  let reject = true;
  let downloads = 0;
  const onDownload = () => {
    downloads++;
  };
  page.on("download", onDownload);
  await page.route(endpoint, async (route) => {
    calls++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    if (reject) {
      // A login/error HTML response must never become a PDF download or success.
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html>Sesión no disponible</html>",
      });
    } else {
      const response = await route.fetch();
      received = await response.body();
      await route.fulfill({ response, body: received });
    }
  });
  for (const fail of [true, false]) {
    reject = fail;
    release = undefined;
    const download = fail ? undefined : page.waitForEvent("download");
    await control.click();
    const loading = toast.filter({ hasText: "Preparando descarga…" });
    await expect(loading).toHaveCount(1);
    await expect(loading).toHaveAttribute("data-state", "loading");
    const id = await loading.getAttribute("data-sileo-id");
    await expect(control).toHaveAttribute("aria-busy", "true");
    if (signed) await expect(control).toHaveAttribute("aria-disabled", "true");
    else await expect(control).toBeDisabled();
    await expect(
      page.locator("[data-download-status], [data-download-error]"),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(
        `${signed ? "signed" : "unsigned"}-download-loading-${fail}.png`,
      ),
      fullPage: true,
    });
    await expect.poll(() => Boolean(release)).toBe(true);
    release!();
    const result = page.locator(
      `[data-sileo-id="${id}"][data-exiting="false"]`,
    );
    await expect(result).toHaveAttribute(
      "data-state",
      fail ? "error" : "success",
    );
    if (fail) {
      await expect(result).toContainText("No se pudo confirmar el PDF");
      expect(downloads).toBe(0);
    } else {
      await expect(result).toContainText("PDF listo.");
      const artifact = await download!;
      expect(
        createHash("sha256")
          .update(new Uint8Array(await readFile((await artifact.path())!)))
          .digest("hex"),
      ).toBe(
        createHash("sha256").update(new Uint8Array(received!)).digest("hex"),
      );
      expect(received!.subarray(0, 5).toString()).toBe("%PDF-");
      expect(downloads).toBe(1);
    }
    await expect(control).not.toHaveAttribute("aria-busy");
    await expect(control).not.toHaveAttribute("aria-disabled");
    if (!signed) await expect(control).toBeEnabled();
    await page.screenshot({
      path: info.outputPath(
        `${signed ? "signed" : "unsigned"}-download-${fail ? "error" : "success"}.png`,
      ),
      fullPage: true,
    });
  }
  expect(calls).toBe(2);
  await page.unroute(endpoint);
  page.off("download", onDownload);
}
async function uploadReviewIssue(
  page: Page,
  record: CertificateDto,
  bytes: Buffer,
  visual?: TestInfo,
) {
  const path = `/app/certificados/${record.id}`;
  const shot = (name: string) =>
    visual!.outputPath(`${record.hasSignedPdf ? "replacement-" : ""}${name}`);
  await page.goto(path);
  const save = page.getByRole("button", {
    name: record.hasSignedPdf ? "Sustituir PDF firmado" : "Guardar PDF firmado",
    exact: true,
  });
  await expect(save).toBeHidden();
  const zone = page.locator("[data-dropzone]");
  const details = page.locator("[data-file-details]");
  await expect(zone).toBeVisible();
  await expect(details).toBeHidden();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  const file = page.locator('input[type="file"]');
  await expect(page.locator("[data-signed-pdf-form]")).toHaveAttribute(
    "data-enhanced",
    "true",
  );
  if (visual) {
    await file.focus();
    await expect(file).toBeFocused();
    for (const width of [375, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(page);
      const zoneBounds = await zone.boundingBox();
      const formBounds = await page
        .locator("[data-signed-pdf-form]")
        .boundingBox();
      expect(zoneBounds?.width).toBe(formBounds?.width);
      const minimum = await zone.evaluate((element) => ({
        minimum: parseFloat(getComputedStyle(element).minHeight),
        unit: parseFloat(getComputedStyle(document.documentElement).fontSize),
      }));
      expect(minimum.minimum).toBe(12.5 * minimum.unit);
      await page.screenshot({
        path: shot(`upload-empty-${width}.png`),
        fullPage: true,
      });
    }
    await file.setInputFiles({
      name: "damaged.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nnot a valid PDF\n%%EOF"),
    });
    await expect(page.locator("[data-file-error]")).toContainText("dañado");
    await expect(save).toBeHidden();
    await expect(zone).toBeHidden();
    await expect(details).toContainText("damaged.pdf");
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(page);
      await page.screenshot({
        path: shot(`upload-rejected-${width}.png`),
        fullPage: true,
      });
    }
    await page
      .getByRole("button", { name: "Quitar archivo", exact: true })
      .click();
    await expect(save).toBeHidden();
    await expect(file).toBeFocused();
    await expect(zone).toBeVisible();
    await expect(details).toBeHidden();
    await expect(page.locator("[data-file-error]")).toHaveText("");
  }
  const selectedFile = {
    name: "synthetic-qa-signed.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  };
  if (visual) {
    const chooser = page.waitForEvent("filechooser");
    await file.press("Enter");
    await (await chooser).setFiles(selectedFile);
  } else await file.setInputFiles(selectedFile);
  await expect(save).toBeEnabled();
  await expect(zone).toBeHidden();
  await expect(details).toContainText(selectedFile.name);
  if (visual) {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(page);
      await page.screenshot({
        path: shot(`upload-selected-${width}.png`),
        fullPage: true,
      });
    }
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({
      path: shot("upload-selected-dark.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.evaluate(() =>
      document.documentElement.classList.remove("dark"),
    );
    await page
      .getByRole("button", { name: "Quitar archivo", exact: true })
      .click();
    await expect(save).toBeHidden();
    await expect(zone).toBeVisible();
    await expect(details).toBeHidden();
    await expect(file).toBeFocused();
    await expect(file).toHaveValue("");
    await expect(page.locator("[data-upload-status]")).toHaveText("");
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(page);
      await page.screenshot({
        path: shot(`upload-reset-${width}.png`),
        fullPage: true,
      });
    }
    // Exercise actual browser File/DataTransfer selection, not a fake success response.
    await page.locator("[data-dropzone]").evaluate(
      (zone, contents) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(
            [new Uint8Array(contents)],
            "certificado-sintetico-con-firmas-para-validacion-visual.pdf",
            { type: "application/pdf" },
          ),
        );
        zone.dispatchEvent(
          new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer }),
        );
        zone.dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
        );
      },
      [...bytes],
    );
    await expect(save).toBeEnabled();
    await expect(zone).toBeHidden();
    let release: (() => void) | undefined;
    await page.route(`**${path}/cargar`, async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          message: "Servicio temporalmente no disponible. Reintenta.",
        }),
      });
    });
    await save.click();
    await expect(page.locator("[data-signed-pdf-form]")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute("aria-busy", "true");
    await expect(save.locator("svg")).toHaveCount(0);
    await expect(page.locator("[data-upload-status]")).toHaveText("");
    const loadingToast = page
      .locator('[data-sileo-toast][data-exiting="false"]')
      .filter({ hasText: "Guardando PDF firmado…" });
    await expect(loadingToast).toHaveCount(1);
    await expect(loadingToast).toHaveAttribute("data-state", "loading");
    const saveNoticeId = await loadingToast.getAttribute("data-sileo-id");
    await page.screenshot({
      path: shot("upload-loading.png"),
      fullPage: true,
    });
    await expect.poll(() => Boolean(release)).toBe(true);
    release!();
    await expect(page.locator("[data-upload-error]")).toContainText(
      "Reintenta",
    );
    await expect(page.locator("[data-upload-error]")).toBeFocused();
    await expect(save).toBeEnabled();
    await expect(
      page.locator(`[data-sileo-id="${saveNoticeId}"][data-exiting="false"]`),
    ).toHaveAttribute("data-state", "error");
    await expect(details).toContainText(
      "certificado-sintetico-con-firmas-para-validacion-visual.pdf",
    );
    await page.screenshot({
      path: shot("upload-error.png"),
      fullPage: true,
    });
    await page.unroute(`**${path}/cargar`);
    await page.route(`**${path}/cargar`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          value: { id: record.id, state: "issued" },
        }),
      }),
    );
    await save.click();
    await expect(page.locator("[data-upload-error]")).toContainText(
      "No se pudo confirmar",
    );
    await expect(save).toBeEnabled();
    await expect(details).toBeVisible();
    await expect(zone).toBeHidden();
    await expect(
      page.getByRole("link", { name: "Descargar firmado", exact: true }),
    ).toHaveCount(record.hasSignedPdf ? 1 : 0);
    await page.unroute(`**${path}/cargar`);
  }
  const uploaded = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `${path}/cargar`,
  );
  await expect(save).toBeEnabled();
  let completeUpload: (() => void) | undefined;
  let uploadCalls = 0;
  await page.route(`**${path}/cargar`, async (route) => {
    uploadCalls++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const committed: { ok: boolean; value: CertificateDto } =
      await response.json();
    expect(committed.ok).toBe(true);
    expect(committed.value.state).toBe("issued");
    expect(committed.value.signedSha256).toBe(
      createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
    );
    await new Promise<void>((resolve) => {
      completeUpload = resolve;
    });
    await route.fulfill({ response });
  });
  await save.click();
  const pendingToast = page
    .locator('[data-sileo-toast][data-exiting="false"]')
    .filter({ hasText: "Guardando PDF firmado…" });
  await expect(pendingToast).toHaveCount(1);
  const noticeId = await pendingToast.getAttribute("data-sileo-id");
  await expect(pendingToast).toHaveAttribute("data-state", "loading");
  await expect(save).toBeDisabled();
  await expect(save).toHaveText(
    record.hasSignedPdf ? "Sustituir PDF firmado" : "Guardar PDF firmado",
  );
  await page.locator("[data-signed-pdf-form]").dispatchEvent("submit");
  await expect.poll(() => Boolean(completeUpload)).toBe(true);
  expect(uploadCalls).toBe(1);
  await expect(pendingToast).toHaveAttribute("data-state", "loading");
  if (visual)
    await page.screenshot({
      path: shot("upload-confirmation-pending.png"),
      fullPage: true,
    });
  completeUpload!();
  expect((await uploaded).status()).toBe(200);
  await expect(
    page.locator(`[data-sileo-id="${noticeId}"][data-exiting="false"]`),
  ).toHaveAttribute("data-state", "success");
  await page.unroute(`**${path}/cargar`);
  await expect(
    page.getByRole("link", { name: "Consultar estado público" }),
  ).toBeVisible();
  await expect(
    page.getByText("Datos para compartir o añadir a LinkedIn", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Copiar datos de credencial",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("SHA-256 del PDF firmado", { exact: true }),
  ).toBeVisible();
}
async function assertNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
async function captureDark(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.theme = "dark";
  });
  await assertNoOverflow(page);
  await page.screenshot({
    path: info.outputPath(name),
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.dataset.theme = "light";
  });
  // Finish real theme transitions before the next light capture. Otherwise a
  // dark surface can be photographed halfway through its return to light.
  await page.evaluate(async () => {
    document.documentElement.getBoundingClientRect();
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

test("ADMIN configures a single recipient certificate, regenerates drafts, saves and substitutes signed PDF; anonymous file comparison stays local", async ({
  page,
  context,
  browser,
}, testInfo) => {
  const fixture = await createAttendanceFlowFixture("2020-05-04");
  let anonymous: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await context.clock.setFixedTime(fixture.now);
    const environment = getTestSupabaseEnvironment();
    const ledger = await fixture.database.db.execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    expect(ledger[0]!.count).toBe(
      readMigrationFiles({
        migrationsFolder: resolve(process.cwd(), "drizzle"),
      }).length,
    );
    console.info(
      "Certificate UI isolated QA",
      process.env.TEST_SUPABASE_PROJECT_ID,
      "API",
      new URL(environment.apiUrl).port,
      "DB",
      new URL(environment.databaseUrl).port,
      "APP",
      new URL(e2eSiteUrl()).port,
      "ledger",
      ledger[0]!.count,
    );
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    anonymous = await browser.newContext();
    await anonymous.clock.setFixedTime(fixture.now);
    const publicPage = await anonymous.newPage();
    await closeOfficialGroup(page, fixture);
    await page.goto("/app/certificados?search=attendance");
    const courseSearch = page.getByRole("search", { name: "Buscar cursos" });
    await expect(courseSearch).toBeVisible();
    await expect(courseSearch.getByLabel("Buscar cursos")).toHaveValue(
      "attendance",
    );
    const groupCertificateLink = page.locator(
      `a[href="${groupPath(fixture)}/certificados"]`,
    );
    await expect(groupCertificateLink).toBeVisible();
    await expect(
      courseSearch.getByRole("combobox", { name: "Estado del curso: Activos" }),
    ).toBeVisible();
    expect(
      (await page.request.get("/app/certificados?status=invalid")).status(),
    ).toBe(400);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`certificate-course-filters-${width}.png`),
        fullPage: true,
      });
    }
    const picker = courseSearch.getByRole("combobox");
    await picker.focus();
    await page.keyboard.press("Space");
    await page.getByRole("option", { name: "Archivados", exact: true }).click();
    await expect(groupCertificateLink).toBeHidden();
    await expect(page).toHaveURL(/status=ARCHIVED/);
    await picker.click();
    await page.getByRole("option", { name: "Todos", exact: true }).click();
    await expect(groupCertificateLink).toBeVisible();
    await expect(
      page.locator(
        `a[href="/app/cursos/${fixture.courseId}/grupos/${fixture.groupId}/certificados"]`,
      ),
    ).toHaveCount(0);
    await page.reload();
    await expect(courseSearch.getByLabel("Buscar cursos")).toHaveValue(
      "attendance",
    );
    await expect(
      courseSearch.getByRole("combobox", { name: "Estado del curso: Todos" }),
    ).toBeVisible();
    await fixture.database.db
      .update(courses)
      .set({ status: "ARCHIVED" })
      .where(eq(courses.id, fixture.historyCourseId));
    await page.goto("/app/certificados?search=attendance&status=ARCHIVED");
    await expect(groupCertificateLink).toBeVisible();
    await page.goto("/app/certificados?search=attendance");
    await expect(groupCertificateLink).toBeHidden();
    await fixture.database.db
      .update(courses)
      .set({ status: "PUBLISHED" })
      .where(eq(courses.id, fixture.historyCourseId));
    await page.reload();
    await expect(groupCertificateLink).toBeVisible();
    await expect(
      page.locator(
        `a[href="/app/cursos/${fixture.courseId}/grupos/${fixture.groupId}/certificados"]`,
      ),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Configurar firmantes" }),
    ).toHaveCount(0);
    await courseSearch.getByLabel("Buscar cursos").fill("sin-coincidencia");
    await expect(
      page.getByText(
        "No hay cursos con cierre académico vigente que coincidan con la búsqueda y el estado seleccionado.",
      ),
    ).toBeVisible();
    await courseSearch.getByLabel("Buscar cursos").fill("ATTENDANCE");
    await expect(groupCertificateLink).toBeVisible();
    await courseSearch.getByLabel("Buscar cursos").fill("");
    await expect(groupCertificateLink).toBeVisible();
    await page.goto(`${groupPath(fixture)}/certificados`);
    await expect(
      page.getByRole("link", { name: "Configurar firmantes" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Generar PDF", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Certificados", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Consultar cierre oficial" }),
    ).toHaveCount(0);
    await settings(page, fixture.historyCourseId.slice(0, 8));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await assertNoOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("settings-desktop.png"),
      fullPage: true,
    });
    let record = await generate(page, fixture);
    const oldCode = record.publicCredentialId;
    await expect(
      page.getByRole("button", { name: "Regenerar PDF", exact: true }),
    ).toHaveCount(0);
    // A saved material authority change is adopted internally at download time;
    // visiting/refetching the detail itself must not rotate the credential.
    await settings(page, `${fixture.historyCourseId.slice(0, 8)} actualizado`);
    await page.goto(`/app/certificados/${record.id}`);
    const unchangedDetail = await page.request.get(
      `/app/certificados/${record.id}`,
      { headers },
    );
    expect(
      ((await unchangedDetail.json()) as { data: CertificateDto }).data
        .publicCredentialId,
    ).toBe(oldCode);
    const regenerated = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/generado.pdf"),
    );
    await page
      .getByRole("button", { name: "Descargar para firmar", exact: true })
      .click();
    expect((await regenerated).status()).toBe(200);
    await expect(page).toHaveURL(/\?prepared=updated$/u);
    await expect(
      page.getByRole("button", { name: "Descargar para firmar", exact: true }),
    ).toBeVisible();
    const currentResponse = await page.request.get(
      `/app/certificados/${record.id}`,
      { headers },
    );
    record = ((await currentResponse.json()) as { data: CertificateDto }).data;
    expect(record.publicCredentialId).not.toBe(oldCode);
    await checkDownloadFeedback(page, false, testInfo);
    const stableDetail = await page.request.get(
      `/app/certificados/${record.id}`,
      { headers },
    );
    const stableRecord = (
      (await stableDetail.json()) as { data: CertificateDto }
    ).data;
    expect(stableRecord.publicCredentialId).toBe(record.publicCredentialId);
    expect(stableRecord.revision).toBe(record.revision);
    await publicPage.goto(`/certificados/${oldCode}`);
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado no disponible",
        exact: true,
      }),
    ).toBeVisible();
    expect(record.data.recipientName).toContain("Enrolled");
    await publicPage.goto(`/certificados/${record.publicCredentialId}`);
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado no emitido",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      publicPage.getByText(record.data.recipientName, { exact: true }),
    ).toHaveCount(0);
    const signed = await signedFixture();
    await uploadReviewIssue(page, record, signed, testInfo);
    await expect(
      page.getByRole("button", { name: "Descargar para firmar" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Regenerar PDF" }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.get(`/app/certificados/${record.id}/generado.pdf`)
      ).status(),
    ).toBe(404);
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("signed-detail-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await assertNoOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("signed-detail-desktop.png"),
      fullPage: true,
    });
    const privateFile = await page.request.get(
      `/app/certificados/${record.id}/firmado.pdf`,
    );
    expect(privateFile.status()).toBe(200);
    expect(privateFile.headers()["cache-control"]).toBe("private, no-store");
    expect(privateFile.headers()["content-disposition"]).toContain(
      "attachment;",
    );
    expect((await privateFile.body()).toString("hex")).toBe(
      signed.toString("hex"),
    );
    await checkDownloadFeedback(page, true, testInfo);
    await publicPage.goto(`/certificados/${record.publicCredentialId}`);
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado vigente",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      publicPage.getByRole("link", { name: /Descargar PDF/ }),
    ).toHaveCount(0);
    const html = await publicPage.content();
    expect(html).not.toMatch(
      /participantId|registrationId|balanceCents|signedPath|certificate-documents|@test\.invalid/u,
    );
    await expect(
      publicPage.getByText(
        "El registro oficial confirma que esta credencial está vigente.",
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(
      publicPage.getByRole("button", { name: "Quitar archivo", exact: true }),
    ).toBeHidden();
    let transmitted = 0;
    const publicReads: string[] = [];
    publicPage.on("request", (request) => {
      if (request.method() !== "GET") transmitted += 1;
      if (request.headers().accept === "application/json")
        publicReads.push(new URL(request.url()).pathname);
    });
    const publicPicker = publicPage.getByLabel("Seleccionar PDF firmado");
    const accessibleFileHeading = publicPage.getByRole("heading", {
      name: "Comprobar tu archivo",
      exact: true,
    });
    // sr-only remains in the accessibility tree, not display:none.
    const hiddenHeadingBounds = await accessibleFileHeading.boundingBox();
    expect(hiddenHeadingBounds!.width).toBe(1);
    expect(hiddenHeadingBounds!.height).toBe(1);
    await publicPicker.focus();
    await expect(publicPicker).toBeFocused();
    const publicChooser = publicPage.waitForEvent("filechooser");
    await publicPicker.press("Enter");
    await (
      await publicChooser
    ).setFiles({
      name: "synthetic-qa-signed.pdf",
      mimeType: "application/pdf",
      buffer: signed,
    });
    await expect(
      publicPage.getByRole("status", {
        name: "Resultado de comparación local",
      }),
    ).toContainText("certificado vigente");
    await expect(
      publicPage.locator("[data-local-verification]"),
    ).toHaveAttribute(
      "data-official-hash",
      createHash("sha256").update(new Uint8Array(signed)).digest("hex"),
    );
    const localResult = publicPage.getByRole("status", {
      name: "Resultado de comparación local",
    });
    await expect(localResult).toHaveAttribute("data-tone", "valid");
    expect(publicReads).toEqual([`/certificados/${record.publicCredentialId}`]);
    await expect(
      publicPage.locator(
        '[data-sileo-toast][data-exiting="false"][data-state="success"]',
      ),
    ).toContainText("El archivo coincide.");
    await expect(publicPage.locator("[data-local-hash]")).toHaveCount(0);
    await expect(publicPage.locator("main")).not.toContainText(
      /[a-f0-9]{64}/iu,
    );
    await expect(
      publicPage.getByText("Código de credencial", { exact: true }),
    ).toHaveCount(0);
    const dropzone = publicPage.locator("[data-local-dropzone]");
    await expect(dropzone).toBeHidden();
    await expect(publicPage.locator("[data-local-selection]")).toBeVisible();
    await expect(publicPage.locator("[data-code-verification]")).toHaveCount(0);
    await expect(publicPage.locator("summary")).toHaveCount(0);
    await expect(publicPage).toHaveURL(
      `/certificados/${record.publicCredentialId}`,
    );
    for (const width of [375, 768, 1440]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(publicPage);
      await publicPage.screenshot({
        path: testInfo.outputPath(`public-selected-${width}.png`),
        fullPage: true,
      });
      if (width >= 1024) {
        const compact = await publicPage
          .locator("[data-local-selection]")
          .boundingBox();
        const information = await publicPage
          .getByRole("region", { name: "Datos públicos del certificado" })
          .boundingBox();
        expect(compact!.height).toBeLessThan(information!.height);
      }
      await captureDark(
        publicPage,
        testInfo,
        `public-selected-dark-${width}.png`,
      );
    }
    await publicPage
      .getByRole("button", { name: "Quitar archivo", exact: true })
      .click();
    await expect(dropzone).toBeVisible();
    await expect(publicPage.locator("[data-local-selection]")).toBeHidden();
    const changedTransfer = await publicPage.evaluateHandle(
      (bytes) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([new Uint8Array(bytes)], "changed.pdf", {
            type: "application/pdf",
          }),
        );
        return transfer;
      },
      [...signed, 0],
    );
    await dropzone.dispatchEvent("dragenter", {
      dataTransfer: changedTransfer,
    });
    await expect(dropzone).toHaveAttribute("data-dragging", "");
    await dropzone.dispatchEvent("drop", { dataTransfer: changedTransfer });
    await expect(dropzone).not.toHaveAttribute("data-dragging");
    await changedTransfer.dispose();
    await expect(
      publicPage.getByRole("status", {
        name: "Resultado de comparación local",
      }),
    ).toContainText("no coincide");
    await expect(localResult).toHaveAttribute("data-tone", "error");
    await expect(publicPage.locator("[data-code-verification]")).toHaveCount(0);
    await expect(publicPage).toHaveURL(
      `/certificados/${record.publicCredentialId}`,
    );
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado vigente",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      publicPage
        .locator('[data-sileo-toast][data-exiting="false"][data-state="error"]')
        .last(),
    ).toContainText("no coincide");
    await expect(dropzone).toBeHidden();
    await expect(publicPage.locator("[data-local-selection]")).toBeVisible();
    for (const width of [375, 768, 1440]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(publicPage);
      await publicPage.screenshot({
        path: testInfo.outputPath(`public-mismatch-${width}.png`),
        fullPage: true,
      });
      await captureDark(
        publicPage,
        testInfo,
        `public-mismatch-dark-${width}.png`,
      );
    }
    // Delay a genuine File read, not the digest or registry response. The older
    // calculation must not overwrite the newer selection or a reset.
    await publicPage.evaluate(() => {
      const view = window as typeof window & {
        releaseRead?: () => void;
        completedDigests: number;
      };
      view.completedDigests = 0;
      const read = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function () {
        const bytes = await read.call(this);
        if (this.name !== "slow.pdf") return bytes;
        return new Promise<ArrayBuffer>((resolve) => {
          view.releaseRead = () => resolve(bytes);
        });
      };
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = async (
        ...args: Parameters<SubtleCrypto["digest"]>
      ) => {
        const result = await digest(...args);
        view.completedDigests += 1;
        return result;
      };
    });
    await publicPage.getByLabel("Seleccionar PDF firmado").setInputFiles({
      name: "slow.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from([...signed, 0]),
    });
    await publicPage.waitForFunction(
      () =>
        typeof (window as typeof window & { releaseRead?: () => void })
          .releaseRead === "function",
    );
    const hashLoading = publicPage.locator(
      '[data-sileo-toast][data-exiting="false"][data-state="loading"]',
    );
    await expect(hashLoading).toHaveCount(1);
    const oldHashNotice = await hashLoading.getAttribute("data-sileo-id");
    await publicPage.screenshot({
      path: testInfo.outputPath("public-hash-loading.png"),
      fullPage: true,
      animations: "disabled",
    });
    await publicPage.getByLabel("Seleccionar PDF firmado").setInputFiles({
      name: "newest.pdf",
      mimeType: "application/pdf",
      buffer: signed,
    });
    await expect(
      publicPage.getByRole("status", {
        name: "Resultado de comparación local",
      }),
    ).toContainText("certificado vigente");
    await publicPage.evaluate(() =>
      (window as typeof window & { releaseRead?: () => void }).releaseRead?.(),
    );
    await publicPage.waitForFunction(
      () =>
        (window as typeof window & { completedDigests: number })
          .completedDigests === 2,
    );
    await expect(localResult).toHaveText(
      "El archivo coincide con el PDF firmado del certificado vigente.",
    );
    await expect(localResult).toHaveAttribute("data-tone", "valid");
    await expect(
      publicPage.locator(
        `[data-sileo-id="${oldHashNotice}"][data-exiting="false"]`,
      ),
    ).toHaveCount(0);
    await expect(hashLoading).toHaveCount(0);
    await expect(publicPage.locator("main")).not.toContainText(
      /[a-f0-9]{64}/iu,
    );
    await publicPage.evaluate(() => {
      delete (window as typeof window & { releaseRead?: () => void })
        .releaseRead;
    });
    await publicPage.getByLabel("Seleccionar PDF firmado").setInputFiles({
      name: "slow.pdf",
      mimeType: "application/pdf",
      buffer: signed,
    });
    await publicPage.waitForFunction(
      () =>
        typeof (window as typeof window & { releaseRead?: () => void })
          .releaseRead === "function",
    );
    await publicPage
      .getByRole("button", { name: "Quitar archivo", exact: true })
      .focus();
    await publicPage.keyboard.press("Enter");
    await expect(
      publicPage.getByLabel("Seleccionar PDF firmado"),
    ).toBeFocused();
    await expect(
      publicPage.getByRole("button", { name: "Quitar archivo", exact: true }),
    ).toBeHidden();
    await expect(dropzone).toBeVisible();
    await expect(publicPage.locator("[data-local-selection]")).toBeHidden();
    await expect(hashLoading).toHaveCount(0);
    await publicPage.evaluate(() =>
      (window as typeof window & { releaseRead?: () => void }).releaseRead?.(),
    );
    await publicPage.waitForFunction(
      () =>
        (window as typeof window & { completedDigests: number })
          .completedDigests === 3,
    );
    await expect(
      publicPage.getByRole("status", {
        name: "Resultado de comparación local",
      }),
    ).toHaveText("");
    await expect(
      publicPage.getByLabel("SHA-256 del archivo seleccionado"),
    ).toHaveCount(0);
    await expect(publicPage.getByLabel("Seleccionar PDF firmado")).toHaveValue(
      "",
    );
    for (const rejected of [
      { name: "wrong.txt", mimeType: "text/plain", buffer: signed },
      { name: "wrong.pdf", mimeType: "text/plain", buffer: signed },
      {
        name: "empty.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(0),
      },
      {
        name: "large.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
      },
    ]) {
      await publicPicker.setInputFiles(rejected);
      await expect(localResult).toHaveAttribute("data-tone", "error");
      await expect(publicPicker).toHaveAttribute("aria-invalid", "true");
      await expect(hashLoading).toHaveCount(0);
      await publicPage
        .getByRole("button", { name: "Quitar archivo", exact: true })
        .click();
      await expect(localResult).toHaveText("");
      await expect(publicPicker).toBeFocused();
    }
    expect(transmitted).toBe(0);
    const anonymousFile = await publicPage.request.get(
      `/app/certificados/${record.id}/firmado.pdf`,
      { maxRedirects: 0 },
    );
    expect(anonymousFile.status()).not.toBe(200);
    for (const width of [375, 768, 1440]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(publicPage);
      const article = publicPage.locator("main > article");
      const bounds = await article.boundingBox();
      const mainBounds = await publicPage.locator("main").boundingBox();
      expect(bounds?.width).toBe(mainBounds?.width);
      if (width >= 1024) {
        const information = await publicPage
          .getByRole("region", { name: "Datos públicos del certificado" })
          .boundingBox();
        const emptyZone = await dropzone.boundingBox();
        expect(emptyZone!.y).toBe(information!.y);
        expect(emptyZone!.height).toBe(information!.height);
        expect(emptyZone!.width).toBe(information!.width);
      }
      await publicPage.screenshot({
        path: testInfo.outputPath(`public-${width}.png`),
        fullPage: true,
      });
      await captureDark(publicPage, testInfo, `public-empty-dark-${width}.png`);
    }
    const replacementBytes = await signedFixture(
      "SYNTHETIC QA: replacement file, no institutional signature",
    );
    // Leave both primary contexts open while the normal ADMIN flow changes
    // the same signed artifact. Neither comparison may trust its cached hash.
    const pdfPrimary = await anonymous.newPage();
    const pdfPrimaryCode = pdfPrimary.getByLabel("Código del certificado", {
      exact: true,
    });
    const pdfPrimaryResult = pdfPrimary.getByRole("status", {
      name: "Resultado de comparación local",
    });
    await pdfPrimary.goto("/certificados/verificar");
    await expect(pdfPrimary.locator("[data-local-controls]")).toBeVisible();
    await pdfPrimary.getByLabel("Seleccionar PDF firmado").setInputFiles({
      name: "original.pdf",
      mimeType: "application/pdf",
      buffer: signed,
    });
    await expect(pdfPrimaryCode).toBeFocused();
    await expect(pdfPrimaryResult).toHaveAttribute("data-tone", "valid");
    const currentSigned = await page.request.get(
      `/app/certificados/${record.id}`,
      { headers },
    );
    const signedRecord = (
      (await currentSigned.json()) as { data: CertificateDto }
    ).data;
    expect(
      (
        await page.request.post(`/app/certificados/${record.id}/generado.pdf`, {
          headers,
          form: {
            revision: String(signedRecord.revision),
            requestKey: crypto.randomUUID(),
          },
        })
      ).status(),
    ).toBe(409);
    await uploadReviewIssue(page, signedRecord, replacementBytes, testInfo);
    const substituted = (
      (await (
        await page.request.get(`/app/certificados/${record.id}`, { headers })
      ).json()) as { data: CertificateDto }
    ).data;
    expect(substituted.id).toBe(record.id);
    expect(substituted.publicCredentialId).toBe(record.publicCredentialId);
    expect(substituted.signedSha256).toBe(
      createHash("sha256")
        .update(new Uint8Array(replacementBytes))
        .digest("hex"),
    );
    await publicPicker.setInputFiles({
      name: "old-signed.pdf",
      mimeType: "application/pdf",
      buffer: signed,
    });
    await expect(localResult).toHaveAttribute("data-tone", "error");
    await expect(localResult).toContainText("no coincide");
    await expect(
      publicPage.locator("[data-local-verification]"),
    ).toHaveAttribute("data-official-hash", substituted.signedSha256!);
    await expect(publicPage).toHaveURL(
      `/certificados/${record.publicCredentialId}`,
    );
    await expect(publicPage.locator("[data-code-verification]")).toHaveCount(0);
    await expect(
      publicPage.locator(
        '[data-sileo-toast][data-exiting="false"][data-state="success"]',
      ),
    ).toHaveCount(0);
    await pdfPrimaryCode.fill(record.publicCredentialId);
    await pdfPrimary
      .getByRole("button", { name: "Verificar certificado", exact: true })
      .click();
    await expect(pdfPrimaryResult).toHaveAttribute("data-tone", "error");
    await expect(pdfPrimaryResult).toContainText("no coincide");
    await expect(pdfPrimaryCode).toBeFocused();
    await expect(pdfPrimary).toHaveURL(
      `/certificados/${record.publicCredentialId}`,
    );
    await expect(pdfPrimary.locator("[data-local-verification]")).toHaveCount(
      0,
    );
    await expect(
      pdfPrimary.locator(
        '[data-sileo-toast][data-exiting="false"][data-state="success"]',
      ),
    ).toHaveCount(0);
    await publicPicker.setInputFiles({
      name: "current-signed.pdf",
      mimeType: "application/pdf",
      buffer: replacementBytes,
    });
    await expect(localResult).toHaveAttribute("data-tone", "valid");
    // Bind the current PDF, then revoke without reloading either public page.
    await pdfPrimary.goto("/certificados/verificar");
    await expect(pdfPrimary.locator("[data-local-controls]")).toBeVisible();
    await pdfPrimary.getByLabel("Seleccionar PDF firmado").setInputFiles({
      name: "current.pdf",
      mimeType: "application/pdf",
      buffer: replacementBytes,
    });
    await expect(pdfPrimaryCode).toBeFocused();
    await expect(pdfPrimaryResult).toHaveAttribute("data-tone", "valid");
    await page.goto(`${groupPath(fixture)}/certificados`);
    expect(
      (await records(page, fixture)).filter((r) => r.type === "APPROVAL"),
    ).toHaveLength(1);
    await expect(page.getByText(/Versión|Historial/)).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("group-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("group-mobile.png"),
      fullPage: true,
    });
    await page.goto(`/app/certificados/${record.id}`);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(page);
      const publicAction = await page
        .getByRole("link", { name: "Consultar estado público" })
        .boundingBox();
      const revokeAction = await page
        .getByRole("button", { name: "Revocar certificado", exact: true })
        .boundingBox();
      if (width >= 768) expect(revokeAction!.y).toBe(publicAction!.y);
      await page.screenshot({
        path: testInfo.outputPath(`issued-actions-${width}.png`),
        fullPage: true,
      });
    }
    await page
      .getByRole("button", { name: "Revocar certificado", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Revocar certificado", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Revocar certificado", exact: true })
      .click();
    await page
      .getByLabel("Motivo de revocación (obligatorio)")
      .fill("Corrección sintética QA");
    const revoked = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("operation=revoke"),
    );
    await page.getByRole("button", { name: "Revocar", exact: true }).click();
    expect((await revoked).status()).toBe(200);
    await expect(page.getByText("Revocado", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Documento", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Revocar certificado", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("[data-signed-pdf-form]")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Descargar firmado", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Consultar estado público" }),
    ).toBeVisible();
    await expect(
      page.getByText(substituted.signedSha256!, { exact: true }),
    ).toBeVisible();
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`revoked-detail-${width}.png`),
        fullPage: true,
      });
    }
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado vigente",
        exact: true,
      }),
    ).toBeVisible();
    await publicPage.getByLabel("Seleccionar PDF firmado").setInputFiles({
      name: "synthetic-qa-signed.pdf",
      mimeType: "application/pdf",
      buffer: replacementBytes,
    });
    await expect(
      publicPage.getByRole("status", {
        name: "Resultado de comparación local",
      }),
    ).toContainText("coincide, pero el certificado no es válido");
    await expect(localResult).toHaveAttribute("data-tone", "invalid");
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado revocado",
        exact: true,
      }),
    ).toBeVisible();
    await pdfPrimaryCode.fill(record.publicCredentialId);
    await pdfPrimary
      .getByRole("button", { name: "Verificar certificado", exact: true })
      .click();
    await expect(pdfPrimaryResult).toHaveAttribute("data-tone", "invalid");
    await expect(
      pdfPrimary.getByRole("heading", {
        name: "Certificado revocado",
        exact: true,
      }),
    ).toBeVisible();
    await expect(pdfPrimaryCode).toBeFocused();
    await expect(pdfPrimary.locator("[data-local-verification]")).toHaveCount(
      0,
    );
    await expect(
      pdfPrimary.locator(
        '[data-sileo-toast][data-exiting="false"][data-state="success"]',
      ),
    ).toHaveCount(0);
    await pdfPrimary.close();
    await expect(
      publicPage.locator(
        '[data-sileo-toast][data-exiting="false"][data-state="success"]',
      ),
    ).toHaveCount(0);
    await expect(
      publicPage.locator(
        '[data-sileo-toast][data-exiting="false"][data-state="error"]',
      ),
    ).toContainText("Certificado no válido.");
    await expect(dropzone).toBeHidden();
    await expect(publicPage.locator("main")).not.toContainText(
      /[a-f0-9]{64}/iu,
    );
    expect(transmitted).toBe(0);
    for (const width of [375, 768, 1440]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(publicPage);
      await publicPage.screenshot({
        path: testInfo.outputPath(`public-revoked-${width}.png`),
        fullPage: true,
      });
      await captureDark(
        publicPage,
        testInfo,
        `public-revoked-dark-${width}.png`,
      );
    }
    await expect(
      page.getByRole("link", { name: "Preparar reemplazo" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Regenerar PDF", exact: true }),
    ).toHaveCount(0);
    const reissue = page.getByRole("button", {
      name: "Emitir nuevo",
      exact: true,
    });
    await expect(reissue).toBeVisible();
    await reissue.focus();
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(
      new RegExp(`/app/certificados/${record.id}$`),
    );
    await expect(page).toHaveURL(/\/app\/certificados\/[0-9a-f-]{36}$/u);
    const newId = new URL(page.url()).pathname.split("/").at(-1)!;
    expect(newId).not.toBe(record.id);
    const reissued = (
      (await (
        await page.request.get(`/app/certificados/${newId}`, { headers })
      ).json()) as { data: CertificateDto }
    ).data;
    expect(reissued.state).toBe("generated");
    expect(reissued.publicCredentialId).not.toBe(record.publicCredentialId);
    const history = page.getByRole("region", {
      name: "Certificados revocados",
    });
    const historicalCard = history.getByRole("link");
    await expect(historicalCard).toContainText("Corrección sintética QA");
    await expect(historicalCard).toHaveAttribute(
      "href",
      `/app/certificados/${record.id}`,
    );
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`reissued-history-${width}.png`),
        fullPage: true,
      });
    }
    await historicalCard.click();
    await expect(page.getByText("Revocado", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Emitir nuevo", exact: true }),
    ).toHaveCount(0);
    await page.goto(`/app/certificados/${newId}`);
    const reissuedBytes = await signedFixture(
      "SYNTHETIC QA: reissued signed PDF",
    );
    await uploadReviewIssue(page, reissued, reissuedBytes);
    await publicPage.goto(`/certificados/${reissued.publicCredentialId}`);
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado vigente",
        exact: true,
      }),
    ).toBeVisible();
    await publicPage.goto(`/certificados/${record.publicCredentialId}`);
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado revocado",
        exact: true,
      }),
    ).toBeVisible();
    const signedReissue = (
      (await (
        await page.request.get(`/app/certificados/${newId}`, { headers })
      ).json()) as { data: CertificateDto }
    ).data;
    // The primary entry binds the result. Only its complementary method remains;
    // another code must never replace the credential resolved from the PDF.
    await publicPage.goto("/certificados/verificar");
    const codeInput = publicPage.getByLabel("Código del certificado", {
      exact: true,
    });
    const verifyCode = publicPage.getByRole("button", {
      name: "Verificar certificado",
      exact: true,
    });
    await expect(
      publicPage.getByRole("heading", {
        name: "Verificar certificado",
        exact: true,
      }),
    ).toBeVisible();
    await publicPage.goto("/certificados/verificar?codigo=abc");
    const codeError = publicPage.locator("#credential-code-error");
    await expect(codeError).toHaveRole("status");
    await expect(codeError).toContainText(
      "Revisa el código de 32 caracteres del certificado.",
    );
    const errorColors = await codeError.evaluate((error) => {
      const resolveToken = (token: string) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${token})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      const light = getComputedStyle(error).color;
      const lightDestructive = resolveToken("--destructive");
      document.documentElement.classList.add("dark");
      const dark = getComputedStyle(error).color;
      const darkForeground = resolveToken("--foreground");
      document.documentElement.classList.remove("dark");
      return { light, lightDestructive, dark, darkForeground };
    });
    expect(errorColors.light).toBe(errorColors.lightDestructive);
    expect(errorColors.dark).toBe(errorColors.darkForeground);
    await publicPage.goto("/certificados/verificar");
    for (const width of [375, 390, 768, 1440]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(publicPage);
      await publicPage.screenshot({
        path: testInfo.outputPath(`verification-entry-${width}.png`),
        fullPage: true,
      });
      await captureDark(
        publicPage,
        testInfo,
        `verification-entry-dark-${width}.png`,
      );
    }
    await codeInput.fill("x".repeat(32));
    await verifyCode.click();
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado no disponible",
        exact: true,
      }),
    ).toBeVisible();
    await expect(publicPage.locator("#credential-code-error")).toContainText(
      "no disponible",
    );
    await codeInput.fill(reissued.publicCredentialId);
    await verifyCode.click();
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado vigente",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      publicPage.getByRole("region", {
        name: "Datos públicos del certificado",
      }),
    ).toContainText(reissued.data.recipientName);
    await expect(codeInput).toHaveCount(0);
    const hashRequests: { path: string; body: string | null }[] = [];
    publicPage.on("request", (request) => {
      if (request.method() === "POST")
        hashRequests.push({
          path: new URL(request.url()).pathname,
          body: request.postData(),
        });
    });
    await publicPage.goto("/certificados/verificar");
    await publicPicker.setInputFiles({
      name: "reissued.pdf",
      mimeType: "application/pdf",
      buffer: reissuedBytes,
    });
    await expect(localResult).toHaveAttribute("data-tone", "valid");
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado vigente",
        exact: true,
      }),
    ).toBeVisible();
    await expect(codeInput).toBeFocused();
    await expect(publicPicker).toHaveCount(0);
    await expect(publicPage.locator("[data-local-verification]")).toHaveCount(
      0,
    );
    await expect(
      publicPage.locator(
        "[data-file-name], [data-local-reset], [data-local-dropzone], summary",
      ),
    ).toHaveCount(0);
    await expect(publicPage.locator("[data-code-verification]")).toHaveCount(1);
    for (const width of [375, 390, 768, 1440]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(publicPage);
      const information = await publicPage
        .locator("[data-public-data]")
        .boundingBox();
      const complement = await publicPage
        .locator("[data-code-entry]")
        .boundingBox();
      if (width >= 1024) {
        expect(complement!.y).toBe(information!.y);
        expect(complement!.width).toBe(information!.width);
        expect(complement!.height).toBeLessThan(information!.height);
      } else
        expect(complement!.y).toBeGreaterThan(
          information!.y + information!.height,
        );
      await publicPage.screenshot({
        path: testInfo.outputPath(`pdf-first-code-${width}.png`),
        fullPage: true,
      });
      await captureDark(
        publicPage,
        testInfo,
        `pdf-first-code-dark-${width}.png`,
      );
    }
    await codeInput.fill(record.publicCredentialId);
    await verifyCode.click();
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado vigente",
        exact: true,
      }),
    ).toBeVisible();
    await expect(localResult).toContainText(
      "El código no coincide con el certificado del archivo.",
    );
    await expect(localResult).toHaveAttribute("data-tone", "error");
    await expect(publicPage).toHaveURL(
      `/certificados/${reissued.publicCredentialId}`,
    );
    await expect(publicPage.locator("[data-public-data]")).toContainText(
      reissued.data.recipientName,
    );
    await expect(
      publicPage.locator(
        '[data-sileo-toast][data-exiting="false"][data-state="success"]',
      ),
    ).toHaveCount(0);
    await expect(
      publicPage.locator(
        '[data-sileo-toast][data-exiting="false"][data-state="error"]',
      ),
    ).toContainText("El código no coincide");
    for (const width of [375, 390, 768, 1440]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(publicPage);
      await publicPage.screenshot({
        path: testInfo.outputPath(`pdf-first-mismatch-${width}.png`),
        fullPage: true,
      });
      await captureDark(
        publicPage,
        testInfo,
        `pdf-first-mismatch-dark-${width}.png`,
      );
    }
    await codeInput.fill(reissued.publicCredentialId);
    await verifyCode.click();
    await expect(localResult).toHaveAttribute("data-tone", "valid");
    await expect(codeInput).toHaveValue(reissued.publicCredentialId);
    await expect(codeInput).toBeFocused();
    await expect(publicPage.locator("[data-code-verification]")).toHaveCount(1);
    await expect(publicPicker).toHaveCount(0);
    expect(hashRequests).toHaveLength(1);
    await publicPage.goto("/certificados/verificar");
    await publicPicker.setInputFiles({
      name: "revoked.pdf",
      mimeType: "application/pdf",
      buffer: replacementBytes,
    });
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado revocado",
        exact: true,
      }),
    ).toBeVisible();
    await expect(localResult).toHaveAttribute("data-tone", "invalid");
    await expect(
      publicPage.locator(
        '[data-sileo-toast][data-exiting="false"][data-state="success"]',
      ),
    ).toHaveCount(0);
    await expect(codeInput).toBeFocused();
    await expect(publicPicker).toHaveCount(0);
    await codeInput.fill(record.publicCredentialId);
    await verifyCode.click();
    await expect(localResult).toHaveAttribute("data-tone", "invalid");
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado revocado",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      publicPage.locator(
        '[data-sileo-toast][data-exiting="false"][data-state="success"]',
      ),
    ).toHaveCount(0);
    for (const width of [375, 390, 768, 1440]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(publicPage);
      await publicPage.screenshot({
        path: testInfo.outputPath(`pdf-first-revoked-${width}.png`),
        fullPage: true,
      });
      await captureDark(
        publicPage,
        testInfo,
        `pdf-first-revoked-dark-${width}.png`,
      );
    }
    await publicPage.goto("/certificados/verificar");
    await expect(
      publicPage.getByRole("heading", {
        name: "Verificar certificado",
        exact: true,
      }),
    ).toBeVisible();
    await expect(publicPage.locator("[data-local-controls]")).toBeVisible();
    await publicPicker.setInputFiles({
      name: "unknown.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from([...reissuedBytes, 0]),
    });
    await expect(localResult).toContainText("No se encontró");
    await expect(localResult).toHaveAttribute("data-tone", "error");
    await expect(
      publicPage.getByRole("region", {
        name: "Datos públicos del certificado",
      }),
    ).toHaveCount(0);
    expect(hashRequests).toHaveLength(3);
    await publicPage
      .getByRole("button", { name: "Quitar archivo", exact: true })
      .click();
    let releaseLookup: (() => void) | undefined;
    let lookupFinished = false;
    await publicPage.route(
      "**/certificados/verificar-archivo",
      async (route) => {
        const response = await route.fetch();
        await new Promise<void>((resolve) => {
          releaseLookup = resolve;
        });
        await route.fulfill({ response });
        lookupFinished = true;
      },
    );
    await publicPicker.setInputFiles({
      name: "cancelled.pdf",
      mimeType: "application/pdf",
      buffer: reissuedBytes,
    });
    await expect.poll(() => typeof releaseLookup).toBe("function");
    await expect(
      publicPage.locator("[data-local-verification]"),
    ).toHaveAttribute("aria-busy", "true");
    const lookupNotice = publicPage.locator(
      '[data-sileo-toast][data-exiting="false"][data-state="loading"]',
    );
    await expect(lookupNotice).toHaveCount(1);
    const cancelledNotice = await lookupNotice.getAttribute("data-sileo-id");
    await publicPage
      .getByRole("button", { name: "Quitar archivo", exact: true })
      .click();
    await expect(publicPicker).toBeFocused();
    releaseLookup!();
    await expect.poll(() => lookupFinished).toBe(true);
    await expect(
      publicPage.getByRole("heading", {
        name: "Verificar certificado",
        exact: true,
      }),
    ).toBeVisible();
    await expect(localResult).toHaveText("");
    await expect(
      publicPage.locator(
        `[data-sileo-id="${cancelledNotice}"][data-exiting="false"]`,
      ),
    ).toHaveCount(0);
    await expect(
      publicPage.locator(
        '[data-sileo-toast][data-exiting="false"][data-state="success"]',
      ),
    ).toHaveCount(0);
    await publicPage.unroute("**/certificados/verificar-archivo");
    expect(hashRequests).toHaveLength(4);
    for (const request of hashRequests) {
      expect(request.path).toBe("/certificados/verificar-archivo");
      expect(JSON.parse(request.body!)).toEqual({
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(request.body).not.toMatch(
        /%PDF|reissued\.pdf|revoked\.pdf|unknown\.pdf/u,
      );
    }
    await expect(publicPage.locator("main")).not.toContainText(
      /[a-f0-9]{64}/iu,
    );
    const secondRevocation = await page.request.post(
      `/app/certificados/${newId}?operation=revoke`,
      {
        headers,
        form: {
          revision: String(signedReissue.revision),
          requestKey: crypto.randomUUID(),
          reason: "Segunda revocación sintética QA",
        },
      },
    );
    expect(secondRevocation.status()).toBe(200);
    await page.reload();
    await page
      .getByRole("button", { name: "Emitir nuevo", exact: true })
      .click();
    await expect(page).not.toHaveURL(new RegExp(`/app/certificados/${newId}$`));
    await expect(history.getByRole("link")).toHaveCount(2);
    await expect(history).toContainText("Corrección sintética QA");
    await expect(history).toContainText("Segunda revocación sintética QA");
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`history-cards-${width}.png`),
        fullPage: true,
      });
      await captureDark(page, testInfo, `history-cards-dark-${width}.png`);
    }
  } finally {
    try {
      await anonymous?.close();
    } finally {
      await fixture.close();
    }
  }
});

test("historical instructor reads remain scoped; reopening blocks obsolete draft emission without revoking issued credentials", async ({
  page,
  context,
  browser,
}, testInfo) => {
  const fixture = await createAttendanceFlowFixture("2020-06-01", true);
  let instructor: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let instructorPage!: Page;
  try {
    await context.clock.setFixedTime(fixture.now);
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    instructor = await browser.newContext();
    await instructor.clock.setFixedTime(fixture.now);
    instructorPage = await instructor.newPage();
    await closeOfficialGroup(page, fixture);
    await settings(page, fixture.historyCourseId.slice(0, 8));
    const approval = await generate(page, fixture);
    await uploadReviewIssue(page, approval, await signedFixture());
    const teacherCertificate = await generate(page, fixture, "INSTRUCTOR");
    const htmlContext = await browser.newContext({ javaScriptEnabled: false });
    try {
      await htmlContext.clock.setFixedTime(fixture.now);
      await signInFixture(htmlContext, AUTH_FIXTURES.admin.email);
      const htmlPage = await htmlContext.newPage();
      await htmlPage.goto(`/app/certificados/${approval.id}`);
      const htmlSave = htmlPage.getByRole("button", {
        name: "Sustituir PDF firmado",
        exact: true,
      });
      await expect(htmlSave).toBeHidden();
      await expect(htmlPage.getByRole("checkbox")).toHaveCount(0);
      await htmlPage.locator('input[type="file"]').setInputFiles({
        name: "synthetic-html.pdf",
        mimeType: "application/pdf",
        buffer: await signedFixture(),
      });
      await expect(htmlSave).toBeVisible();
      await htmlSave.click();
      await expect(
        htmlPage.getByRole("link", { name: "Descargar firmado", exact: true }),
      ).toBeVisible();
      await expect(htmlSave).toBeHidden();
    } finally {
      await htmlContext.close();
    }
    const foreignCourse = await fixture.database.db
      .select({ instructorId: courses.instructorId })
      .from(courses)
      .where(eq(courses.id, fixture.foreign!.courseId));
    await fixture.database.db
      .update(courses)
      .set({ instructorId: foreignCourse[0]!.instructorId })
      .where(eq(courses.id, fixture.historyCourseId));
    await signInFixture(instructor, AUTH_FIXTURES.instructor.email);
    const path = `/app/mis-certificados/${teacherCertificate.id}`;
    await instructorPage.goto(path);
    await expect(
      instructorPage.getByRole("heading", {
        name: "Certificado de instructor",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      instructorPage.getByRole("button", {
        name: /Cargar|Emitir|Revocar|revisión/,
      }),
    ).toHaveCount(0);
    expect(
      (await instructorPage.request.get(`${path}/generado.pdf`)).status(),
    ).toBe(200);
    const denied = await instructorPage.request.post(
      `/app/certificados/${teacherCertificate.id}?operation=issue`,
      {
        headers,
        data: {
          requestKey: crypto.randomUUID(),
          revision: teacherCertificate.revision,
          actorId: fixture.adminId,
          roles: ["ADMIN"],
        },
        maxRedirects: 0,
      },
    );
    expect(denied.status()).not.toBe(200);
    await instructorPage.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow(instructorPage);
    await instructorPage.screenshot({
      path: testInfo.outputPath("instructor-mobile.png"),
      fullPage: true,
    });
    const closed = await state(page, fixture);
    const reopened = await page.request.post(
      `${groupPath(fixture)}/cierre?operation=reopen`,
      {
        headers,
        data: {
          requestKey: crypto.randomUUID(),
          revision: closed.revision,
          reason: "Reapertura sintética QA",
        },
      },
    );
    expect(reopened.status()).toBe(200);
    await page.goto("/app/certificados?status=ALL");
    await expect(
      page.locator(`a[href="${groupPath(fixture)}/certificados"]`),
    ).toHaveCount(0);
    await page.goto(`/app/certificados/${teacherCertificate.id}`);
    await expect(page.getByText(/El cierre cambió/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Cargar|Emitir|revisión/ }),
    ).toHaveCount(0);
    const stale = await page.request.post(
      `/app/certificados/${teacherCertificate.id}/cargar`,
      {
        headers,
        multipart: {
          requestKey: crypto.randomUUID(),
          revision: teacherCertificate.revision,
          purpose: "SIGNED",
          intent: "save-signed-pdf",
          file: {
            name: "qa.pdf",
            mimeType: "application/pdf",
            buffer: await signedFixture(),
          },
        },
      },
    );
    expect(stale.status()).toBe(409);
    const publicContext = await browser.newContext({
      javaScriptEnabled: false,
    });
    try {
      const publicPage = await publicContext.newPage();
      await publicPage.goto(`/certificados/${approval.publicCredentialId}`);
      await expect(
        publicPage.getByRole("heading", {
          name: "Certificado vigente",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        publicPage.getByText(/Activa JavaScript para comparar/),
      ).toBeVisible();
      await publicPage.goto("/certificados");
      await publicPage
        .getByLabel("Código del certificado")
        .fill(approval.publicCredentialId);
      await publicPage
        .getByRole("button", { name: "Verificar certificado", exact: true })
        .click();
      await expect(
        publicPage.getByRole("heading", {
          name: "Certificado vigente",
          exact: true,
        }),
      ).toBeVisible();
      await publicPage.goto(`/certificados/${"unknown".padEnd(32, "_")}`);
      await expect(
        publicPage.getByRole("heading", {
          name: "Certificado no disponible",
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await publicContext.close();
    }
  } finally {
    try {
      await instructor?.close();
    } finally {
      await fixture.close();
    }
  }
});
