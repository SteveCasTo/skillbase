import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { eq } from "drizzle-orm";
import { users } from "@/server/db/schema";
import type {
  ClosureStateDto,
  ClosureVersionDto,
} from "@/domain/academic-closure/types";
import type { ClosureLoadResult } from "@/server/academic-closure/loaders";
import { createAttendanceFlowFixture } from "../fixtures/attendance-flow";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";
import { e2eSiteUrl } from "../../scripts/e2e-port";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";

test.setTimeout(90_000);
const headers = { Accept: "application/json", Origin: e2eSiteUrl() };
const basePath = (course: string, group: string, instructor = false) =>
  `/app/${instructor ? "mis-cursos" : "cursos"}/${course}/grupos/${group}`;

const documents = [
  ["planilla.pdf", "Planilla PDF"],
  ["planilla.csv", "Planilla CSV"],
  ["informe.pdf", "Informe PDF"],
] as const;
async function exportParticipant(
  fixture: Awaited<ReturnType<typeof createAttendanceFlowFixture>>,
) {
  const repository = createRegistrationRepository(fixture.database.db);
  const detail = await repository.detail(
    fixture.historyPaid.id,
    fixture.adminId,
  );
  if (!detail) throw new Error("Own isolated participant unavailable");
  const person = detail.registration.participant;
  return repository.updateParticipant(
    {
      requestKey: crypto.randomUUID(),
      participantId: person.id,
      revision: person.revision,
      participant: {
        ci: person.ci,
        firstName: "=María Ñúñez",
        lastName: "Álvarez",
        email: person.email,
        phone: "+591 70000000",
      },
    },
    fixture.adminId,
  );
}
/** Actual anchors and browser downloads, followed by a cookie-authenticated GET
 * to inspect headers. No renderer/helper injection or successful network mocks. */
async function downloadOfficialDocuments(
  page: Page,
  path: string,
  version: ClosureVersionDto,
  privateCi: string,
) {
  let csv = "";
  for (const [artifact, label] of documents) {
    const url = `${path}/${version.version}/${artifact}`;
    const link = page.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", url);
    const pending = page.waitForEvent("download");
    await link.click();
    const download = await pending;
    expect(download.url()).toBe(new URL(url, e2eSiteUrl()).href);
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toBe(
      `cierre-v${version.version}-${artifact}`,
    );
    const file = await download.path();
    if (!file) throw new Error("Browser download missing");
    const bytes = await readFile(file);
    const response = await page.request.get(url);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["content-disposition"]).toBe(
      `attachment; filename="cierre-v${version.version}-${artifact}"`,
    );
    if (artifact === "planilla.csv") {
      expect(response.headers()["content-type"]).toBe(
        "text/csv; charset=utf-8",
      );
      expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
      csv = bytes.toString("utf8");
      expect(csv).toContain('"\'=María Ñúñez"');
      expect(csv).toContain('"Álvarez"');
      expect(csv).toContain(version.actorName);
      expect(csv).toContain(version.closedAt);
      expect(csv).toContain(`"${version.report.minimumGrade.toFixed(2)}"`);
      expect(csv).toContain('"80.00"');
      if (version.report.access === "ADMIN") expect(csv).toContain(privateCi);
      else {
        expect(csv).not.toContain(privateCi);
        expect(csv).not.toContain('"CI"');
      }
      expect(csv).not.toMatch(
        /email|phone|balanceCents|Saldo informativo|70000000|@test.invalid/u,
      );
    } else {
      expect(response.headers()["content-type"]).toBe("application/pdf");
      expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      const pdf = await PDFDocument.load(new Uint8Array(bytes), {
        updateMetadata: false,
      });
      expect(pdf.getPageCount()).toBeGreaterThan(0);
      expect(pdf.getAuthor()).toBe(version.actorName);
      // PDF date strings preserve the frozen instant at their supported
      // second precision; CSV retains the full ISO timestamp.
      const pdfInstant = new Date(version.closedAt);
      pdfInstant.setUTCMilliseconds(0);
      expect(pdf.getCreationDate()).toEqual(pdfInstant);
      expect(pdf.getModificationDate()).toEqual(pdfInstant);
    }
  }
  return csv;
}
async function read(page: Page, path: string) {
  const response = await page.request.get(path, { headers });
  expect(response.status()).toBe(200);
  const result = (await response.json()) as ClosureLoadResult<ClosureStateDto>;
  if (!result.available) throw new Error(result.unavailableReason);
  return result.data;
}
async function command(
  page: Page,
  path: string,
  operation: "close" | "reopen",
  revision: number,
  reason?: string,
) {
  return page.request.post(`${path}?operation=${operation}`, {
    headers,
    data: {
      requestKey: crypto.randomUUID(),
      revision,
      ...(reason === undefined ? {} : { reason }),
    },
  });
}
async function prepare(
  page: Page,
  fixture: Awaited<ReturnType<typeof createAttendanceFlowFixture>>,
) {
  const base = basePath(fixture.historyCourseId, fixture.historyGroupId);
  const components = Array.from({ length: 6 }, (_, index) => ({
    id: crypto.randomUUID(),
    name: `Componente ${index + 1}: análisis y aplicación de conocimientos`,
    type: index % 2 ? "PRACTICAL" : "THEORY",
    weight: index === 5 ? "16.65" : "16.67",
  }));
  const scheme = await page.request.post(
    `/app/cursos/${fixture.historyCourseId}/evaluaciones`,
    {
      headers,
      data: { requestKey: crypto.randomUUID(), schemeRevision: 0, components },
    },
  );
  expect(scheme.status()).toBe(200);
  const before = await read(page, `${base}/cierre`);
  expect(before.blockers).toContain("GRADES_PENDING");
  const person = before.provisional!.participants[0]!;
  const grades = await page.request.post(`${base}/evaluaciones`, {
    headers,
    data: {
      requestKey: crypto.randomUUID(),
      schemeRevision: 1,
      registrationId: person.registrationId,
      grades: components.map((component) => ({
        componentId: component.id,
        gradeRevision: 0,
        score: "80.00",
      })),
    },
  });
  expect(grades.status()).toBe(200);
  for (const session of before.provisional!.sessions) {
    const marked = await page.request.post(
      `${base}/sesiones/${session.id}?operation=record`,
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
  expect((await read(page, `${base}/cierre`)).canClose).toBe(true);
  return { base, components, person };
}

test("ADMIN closes, reopens and preserves the immutable official version with readonly academic surfaces", async ({
  page,
  context,
}) => {
  const fixture = await createAttendanceFlowFixture("2020-05-04");
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const base = basePath(fixture.historyCourseId, fixture.historyGroupId),
    path = `${base}/cierre`;
  try {
    const participant = await exportParticipant(fixture);
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Pendientes para cerrar" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cerrar grupo", exact: true }),
    ).toHaveCount(0);
    await prepare(page, fixture);
    await page.goto(path);
    await page
      .getByRole("button", { name: "Cerrar grupo", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Cerrar grupo", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Cerrar grupo", exact: true })
      .click();
    const closed = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === path,
    );
    await page
      .getByRole("button", { name: "Confirmar cierre", exact: true })
      .click();
    expect((await closed).status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Versión oficial 1" }),
    ).toBeVisible();
    const official = (await read(page, path)).official!;
    expect(official.report.participants[0]!.result.finalGrade).toBe("80.00");
    await expect(
      page.getByRole("link", { name: "Planilla PDF" }),
    ).toHaveAttribute("href", `${path}/1/planilla.pdf`);
    const originalCsv = await downloadOfficialDocuments(
      page,
      path,
      official,
      participant.ci,
    );
    const anonymous = await context.browser()!.newContext();
    try {
      const denied = await anonymous.request.get(`${path}/1/planilla.pdf`, {
        maxRedirects: 0,
      });
      expect(denied.status()).toBe(303);
      expect(denied.headers()["location"]).toContain("/login");
      expect(denied.headers()["content-type"]).not.toBe("application/pdf");
    } finally {
      await anonymous.close();
    }
    await page.goto(`${base}/evaluaciones`);
    await expect(
      page.getByRole("button", { name: /Editar notas/ }),
    ).toHaveCount(0);
    await page.goto(`${base}/sesiones/${fixture.pastSession.id}`);
    await expect(
      page.getByRole("button", { name: /Editar|Cancelar sesión|Reprogramar/ }),
    ).toHaveCount(0);
    await page.goto(path);
    await page.getByText("Reabrir grupo", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Confirmar reapertura" }),
    ).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Motivo de reapertura (obligatorio)" })
      .fill("Corrección académica documentada");
    await page.getByRole("button", { name: "Confirmar reapertura" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Grupo abierto · Resultado provisional",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Corrección académica documentada", { exact: false }),
    ).toBeVisible();
    // A second real request closes the group after this page loaded. The stale
    // confirmation must show the new official state, not a provisional receipt.
    await page
      .getByRole("button", { name: "Cerrar grupo", exact: true })
      .click();
    const openState = await read(page, path);
    expect(
      (await command(page, path, "close", openState.revision)).status(),
    ).toBe(200);
    const stale = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === path,
    );
    await page
      .getByRole("button", { name: "Confirmar cierre", exact: true })
      .click();
    expect((await stale).status()).toBe(409);
    await expect(
      page.getByRole("heading", { name: "Versión oficial 2" }),
    ).toBeVisible();
    await expect(page.locator("#closure-error")).not.toBeEmpty();
    await page.getByRole("link", { name: "Versión 1", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Versión 1", exact: true }),
    ).toBeVisible();
    const history = await page.request.get(`${path}/1`, { headers });
    const historicLoad = await history.json();
    expect(historicLoad.data).toEqual(official);
    expect(
      await downloadOfficialDocuments(page, path, official, participant.ci),
    ).toBe(originalCsv);
    await expect(
      page.getByRole("button", { name: /Cerrar grupo|Confirmar reapertura/ }),
    ).toHaveCount(0);
  } finally {
    const state = await read(page, path);
    if (state.status === "CLOSED")
      expect(
        (
          await command(
            page,
            path,
            "reopen",
            state.revision,
            "Limpieza de fixture aislado",
          )
        ).status(),
      ).toBe(200);
    await fixture.close();
  }
});

test("owned INSTRUCTOR can close but never reopen, and current/history SSR and JSON redact private fields", async ({
  page,
  context,
  browser,
}) => {
  const fixture = await createAttendanceFlowFixture("2020-05-04", true);
  const adminContext = await browser.newContext();
  await signInFixture(adminContext, AUTH_FIXTURES.admin.email);
  const admin = await adminContext.newPage();
  const adminPath = `${basePath(fixture.historyCourseId, fixture.historyGroupId)}/cierre`;
  try {
    await exportParticipant(fixture);
    const prepared = await prepare(admin, fixture);
    const adminReport = (await read(admin, adminPath)).provisional!;
    expect(adminReport.access).toBe("ADMIN");
    const sensitive =
      adminReport.access === "ADMIN" ? adminReport.participants[0]!.ci : "";
    await signInFixture(context, AUTH_FIXTURES.instructor.email);
    const path = `${basePath(fixture.historyCourseId, fixture.historyGroupId, true)}/cierre`;
    await page.goto(path);
    await expect(page.getByText(sensitive, { exact: false })).toHaveCount(0);
    await page
      .getByRole("button", { name: "Cerrar grupo", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirmar cierre", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Versión oficial 1" }),
    ).toBeVisible();
    await expect(page.getByText("Reabrir grupo", { exact: true })).toHaveCount(
      0,
    );
    const current = await read(page, path);
    expect(current.official!.report.access).toBe("INSTRUCTOR");
    expect(JSON.stringify(current)).not.toMatch(
      /balanceCents|"ci"|email|phone|participantType/u,
    );
    expect(
      (
        await command(page, path, "reopen", current.revision, "No autorizado")
      ).status(),
    ).toBe(403);
    const wrongRoute = await page.request.get(adminPath);
    expect(wrongRoute.status()).toBe(403);
    expect(
      (await page.request.get(`${adminPath}/1/planilla.pdf`)).status(),
    ).toBe(403);
    const foreign = await page.request.get(
      `${basePath(fixture.foreign!.courseId, fixture.foreign!.groupId, true)}/cierre`,
      { headers },
    );
    expect(foreign.status()).toBe(404);
    expect(
      (
        await page.request.get(
          `${basePath(fixture.foreign!.courseId, fixture.foreign!.groupId, true)}/cierre/1/planilla.pdf`,
          { headers },
        )
      ).status(),
    ).toBe(404);
    await page.goto(
      `${prepared.base.replace("/cursos/", "/mis-cursos/")}/evaluaciones`,
    );
    await expect(
      page.getByRole("button", { name: /Editar notas/ }),
    ).toHaveCount(0);
    // Historic links remain authorized after ADMIN reopens the same group.
    expect(
      (
        await command(
          admin,
          adminPath,
          "reopen",
          current.revision,
          "Verificación de documentos históricos",
        )
      ).status(),
    ).toBe(200);
    await page.goto(`${path}/1`);
    await expect(page.getByText(sensitive, { exact: false })).toHaveCount(0);
    const history = await page.request.get(`${path}/1`, { headers });
    expect(JSON.stringify(await history.json())).not.toMatch(
      /balanceCents|"ci"|email|phone|participantType/u,
    );
    await downloadOfficialDocuments(page, path, current.official!, sensitive);
    expect(
      (
        await page.request.get(`${path}/999999/informe.pdf`, { headers })
      ).status(),
    ).toBe(404);
    // Revoke only the fixture-owned internal actor in this verified ephemeral
    // project. The existing browser session must not retain download permission.
    await fixture.database.db
      .update(users)
      .set({ status: "DISABLED" })
      .where(eq(users.id, fixture.instructorId));
    try {
      const revoked = await page.request.get(`${path}/1/informe.pdf`, {
        maxRedirects: 0,
      });
      expect(revoked.status()).toBe(303);
      expect(revoked.headers()["location"]).toContain("/unauthorized");
      expect(revoked.headers()["content-type"]).not.toBe("application/pdf");
    } finally {
      await fixture.database.db
        .update(users)
        .set({ status: "ACTIVE" })
        .where(eq(users.id, fixture.instructorId));
    }
  } finally {
    const state = await read(admin, adminPath);
    if (state.status === "CLOSED")
      expect(
        (
          await command(
            admin,
            adminPath,
            "reopen",
            state.revision,
            "Limpieza de fixture aislado",
          )
        ).status(),
      ).toBe(200);
    await adminContext.close();
    await fixture.close();
  }
});

test("HTML without JavaScript retains server validation and supports closing and reopening", async ({
  browser,
}) => {
  const fixture = await createAttendanceFlowFixture("2020-05-04");
  const context = await browser.newContext({ javaScriptEnabled: false });
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const page = await context.newPage();
  const path = `${basePath(fixture.historyCourseId, fixture.historyGroupId)}/cierre`;
  try {
    const participant = await exportParticipant(fixture);
    await prepare(page, fixture);
    await page.goto(path);
    await page.getByText("Cerrar grupo", { exact: true }).click();
    await page
      .getByRole("button", { name: "Confirmar cierre", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Versión oficial 1" }),
    ).toBeVisible();
    await downloadOfficialDocuments(
      page,
      path,
      (await read(page, path)).official!,
      participant.ci,
    );
    await page.getByText("Reabrir grupo", { exact: true }).click();
    await page
      .getByRole("textbox", { name: "Motivo de reapertura (obligatorio)" })
      .fill("   ");
    const invalid = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().includes("operation=reopen"),
    );
    await page.getByRole("button", { name: "Confirmar reapertura" }).click();
    expect((await invalid).status()).toBe(422);
    await expect(
      page.getByRole("textbox", { name: "Motivo de reapertura (obligatorio)" }),
    ).toHaveValue("   ");
    await expect(
      page.getByText("Introduce un motivo de 1 a 500 caracteres."),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Motivo de reapertura (obligatorio)" })
      .fill("Corrección desde formulario HTML");
    await page.getByRole("button", { name: "Confirmar reapertura" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Grupo abierto · Resultado provisional",
      }),
    ).toBeVisible();
    expect(
      (
        await page.request.post(`${path}/1`, {
          headers,
          data: { requestKey: crypto.randomUUID(), revision: 0 },
        })
      ).status(),
    ).toBe(405);
    expect(
      (
        await page.request.get(`${path}/9007199254740992`, { headers })
      ).status(),
    ).toBe(404);
  } finally {
    const state = await read(page, path);
    if (state.status === "CLOSED")
      expect(
        (
          await command(
            page,
            path,
            "reopen",
            state.revision,
            "Limpieza de fixture aislado",
          )
        ).status(),
      ).toBe(200);
    await context.close();
    await fixture.close();
  }
});
