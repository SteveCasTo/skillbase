import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createAttendanceFlowFixture } from "../fixtures/attendance-flow";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";
import { e2eSiteUrl } from "../../scripts/e2e-port";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
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
async function settings(page: Page) {
  await page.goto("/app/configuracion/certificados");
  for (const [id, name] of [
    ["departmentHead.name", "Jefatura ficticia QA"],
    ["director.name", "Dirección ficticia QA"],
    ["dean.name", "Decanato ficticio QA"],
  ])
    await page.locator(`[id="${id}"]`).fill(name!);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/app/configuracion/certificados",
  );
  await page
    .getByRole("button", { name: "Guardar configuración", exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('[id="director.name"]')).toHaveValue(
    "Dirección ficticia QA",
  );
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
  const form = page.getByRole("form", {
    name:
      type === "APPROVAL"
        ? "Certificado de aprobación"
        : "Certificado de instructor",
    exact: true,
  });
  await expect(
    form.getByRole("button", { name: "Generar PDF", exact: true }),
  ).toBeEnabled();
  const generated = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/certificados"),
  );
  await form.getByRole("button", { name: "Generar PDF", exact: true }).click();
  expect((await generated).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Documentos del grupo" }),
  ).toBeVisible();
  await expect(
    page.locator('a[href^="/app/certificados/"]').filter({
      hasText:
        type === "APPROVAL"
          ? "Certificado de aprobación"
          : "Certificado de instructor",
    }),
  ).toBeVisible();
  return (await records(page, fixture)).find((record) => record.type === type)!;
}
async function signedFixture() {
  const pdf = await PDFDocument.create();
  pdf.setTitle(
    "SYNTHETIC QA uploaded PDF — not institutional handwritten signatures",
  );
  pdf.addPage().drawText("SYNTHETIC QA: lifecycle upload evidence only");
  return Buffer.from(await pdf.save());
}
async function uploadReviewIssue(
  page: Page,
  record: CertificateDto,
  bytes: Buffer,
) {
  const path = `/app/certificados/${record.id}`;
  await page.goto(path);
  await page.getByLabel(/Cargar PDF firmado/).setInputFiles({
    name: "synthetic-qa-signed.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  const uploaded = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `${path}/cargar`,
  );
  await page
    .getByRole("button", { name: "Cargar PDF firmado", exact: true })
    .click();
  expect((await uploaded).status()).toBe(200);
  const review = page.getByRole("button", {
    name: "Confirmar revisión",
    exact: true,
  });
  await expect(review).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /He revisado el documento/ })
    .check();
  const reviewed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("operation=review"),
  );
  await review.click();
  expect((await reviewed).status()).toBe(200);
  const issued = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("operation=issue"),
  );
  await page
    .getByRole("button", { name: "Emitir certificado", exact: true })
    .click();
  expect((await issued).status()).toBe(200);
  await expect(
    page.getByRole("link", { name: "Consultar estado público" }),
  ).toBeVisible();
}
async function assertNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("ADMIN configures, generates, uploads, reviews, issues, revokes and replaces; anonymous file comparison stays local", async ({
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
    expect(ledger[0]!.count).toBe(24);
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
    await page.goto(`${groupPath(fixture)}/certificados`);
    await expect(
      page.getByRole("button", { name: "Generar PDF", exact: true }),
    ).toHaveCount(2);
    for (const button of await page
      .getByRole("button", { name: "Generar PDF", exact: true })
      .all())
      await expect(button).toBeDisabled();
    await settings(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await assertNoOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("settings-desktop.png"),
      fullPage: true,
    });
    const record = await generate(page, fixture);
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
    await uploadReviewIssue(page, record, signed);
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
    let transmitted = 0;
    publicPage.on("request", (request) => {
      if (request.method() !== "GET") transmitted += 1;
    });
    await publicPage.getByLabel("Seleccionar PDF firmado").setInputFiles({
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
      publicPage.getByLabel("SHA-256 del archivo seleccionado"),
    ).toHaveText(
      createHash("sha256").update(new Uint8Array(signed)).digest("hex"),
    );
    await publicPage.getByLabel("Seleccionar PDF firmado").setInputFiles({
      name: "changed.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from([...signed, 0]),
    });
    await expect(
      publicPage.getByRole("status", {
        name: "Resultado de comparación local",
      }),
    ).toContainText("no coincide");
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
    await expect(
      publicPage.getByLabel("SHA-256 del archivo seleccionado"),
    ).toHaveText(
      createHash("sha256").update(new Uint8Array(signed)).digest("hex"),
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
      .getByRole("button", { name: "Limpiar archivo", exact: true })
      .click();
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
    ).toBeHidden();
    expect(transmitted).toBe(0);
    const anonymousFile = await publicPage.request.get(
      `/app/certificados/${record.id}/firmado.pdf`,
      { maxRedirects: 0 },
    );
    expect(anonymousFile.status()).not.toBe(200);
    await publicPage.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow(publicPage);
    await publicPage.screenshot({
      path: testInfo.outputPath("public-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Revocar certificado", exact: true })
      .click();
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
    await publicPage.reload();
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado revocado",
        exact: true,
      }),
    ).toBeVisible();
    await publicPage.getByLabel("Seleccionar PDF firmado").setInputFiles({
      name: "synthetic-qa-signed.pdf",
      mimeType: "application/pdf",
      buffer: signed,
    });
    await expect(
      publicPage.getByRole("status", {
        name: "Resultado de comparación local",
      }),
    ).toContainText("coincide, pero el certificado no es válido");
    await page
      .getByRole("link", { name: "Preparar reemplazo", exact: true })
      .click();
    const replaceForm = page.getByRole("form", {
      name: "Certificado de aprobación",
      exact: true,
    });
    await replaceForm
      .getByRole("combobox", { name: "Titular del reemplazo" })
      .click();
    await page
      .getByRole("option", { name: record.data.recipientName, exact: true })
      .click();
    await replaceForm
      .getByLabel("Motivo de reemplazo (obligatorio)")
      .fill("Reemplazo sintético QA");
    const prepared = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/certificados"),
    );
    await replaceForm
      .getByRole("button", { name: "Preparar reemplazo", exact: true })
      .click();
    expect((await prepared).status()).toBe(200);
    await expect(
      page
        .locator('a[href^="/app/certificados/"]')
        .filter({ hasText: "PDF generado" }),
    ).toBeVisible();
    const replacement = (await records(page, fixture)).find(
      (entry) => entry.replacementForId === record.id,
    )!;
    expect(replacement).toBeDefined();
    await uploadReviewIssue(page, replacement, signed);
    await publicPage.reload();
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado reemplazado",
        exact: true,
      }),
    ).toBeVisible();
    await publicPage.goto(`/certificados/${replacement.publicCredentialId}`);
    await expect(
      publicPage.getByRole("heading", {
        name: "Certificado vigente",
        exact: true,
      }),
    ).toBeVisible();
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
    await settings(page);
    const approval = await generate(page, fixture);
    await uploadReviewIssue(page, approval, await signedFixture());
    const teacherCertificate = await generate(page, fixture, "INSTRUCTOR");
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
    await page.goto(`/app/certificados/${teacherCertificate.id}`);
    await expect(
      page.getByText(/Este borrador pertenece a un cierre/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Cargar|Emitir|revisión/ }),
    ).toHaveCount(0);
    const stale = await page.request.post(
      `/app/certificados/${teacherCertificate.id}?operation=issue`,
      {
        headers,
        data: {
          requestKey: crypto.randomUUID(),
          revision: teacherCertificate.revision,
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
