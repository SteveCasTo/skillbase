import { expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import type { ClosureRepository } from "@/application/academic-closure/closure-repository";
import type { InternalUser } from "@/domain/auth/types";
import { ClosureError } from "@/domain/academic-closure/rules";
import { privateClosureReport } from "@/server/academic-closure/projection";
import { renderClosureCsv } from "@/server/academic-closure/exports/csv";
import { closureSummary } from "@/server/academic-closure/exports/document";
import { renderClosurePdf } from "@/server/academic-closure/exports/pdf";
import {
  handleClosureDownload,
  parseClosureVersion,
} from "@/server/academic-closure/exports/http";
import {
  closureExportFixture,
  exportId as id,
} from "../fixtures/academic-closure-export";

const actor: InternalUser = {
  id,
  authUserId: id,
  name: "Current actor",
  email: "synthetic@test.invalid",
  status: "ACTIVE",
  roles: ["ADMIN"],
  authPrimaryProvider: "EMAIL",
};
const context = () => ({
  locals: { internalUser: actor },
  params: { id, groupId: id, version: "1" },
});
function repository(): ClosureRepository {
  return {
    getVersion: async () => closureExportFixture(),
    getGroup: async () => {
      throw new Error("must not load provisional");
    },
    close: async () => {
      throw new Error("no writes");
    },
    reopen: async () => {
      throw new Error("no writes");
    },
  };
}
test("official CSV preserves frozen metadata, two decimals, BOM, leading-zero CI and role allowlist", () => {
  const v = closureExportFixture();
  const csv = new TextDecoder().decode(renderClosureCsv(v));
  expect(renderClosureCsv(v).slice(0, 3)).toEqual(
    new Uint8Array([239, 187, 191]),
  );
  for (const text of [
    "Álgebra sintética",
    "Responsable histórico Ñúñez",
    "70.00",
    "'001234QA",
    "No aprobado",
    "100.00 %",
  ])
    expect(csv).toContain(text);
  expect(csv).not.toContain("12345");
  if (v.report.access !== "ADMIN") throw new Error();
  v.report = privateClosureReport(v.report, false);
  const instructor = new TextDecoder().decode(renderClosureCsv(v));
  expect(instructor).not.toContain('"CI"');
  expect(instructor).not.toContain("001234QA");
  expect(instructor).not.toContain("balance");
});
test("CSV escapes quotes, semicolons, newlines and disguised spreadsheet formula values", () => {
  const v = closureExportFixture();
  v.report.courseName = ' \u200b=HYPERLINK("unsafe");\nQA';
  v.report.participants[0]!.firstName = "\t+formula";
  v.report.participants[0]!.lastName = "@SUM(1)";
  const csv = new TextDecoder().decode(renderClosureCsv(v));
  expect(csv).toContain('"\' \u200b=HYPERLINK(""unsafe"");\nQA"');
  expect(csv).toContain('"\'\t+formula"');
  expect(csv).toContain('"\'@SUM(1)"');
});
test("official exports refuse missing or inconsistent historical evidence rather than invent zero", async () => {
  const v = closureExportFixture();
  v.report.participants[0]!.grades[0]!.score = null;
  expect(() => renderClosureCsv(v)).toThrow();
  await expect(renderClosurePdf(v, "planilla")).rejects.toThrow();
  v.report.participants[0]!.grades[0]!.score = "0";
  v.report.participants[0]!.result.status = "PENDING";
  expect(() => renderClosureCsv(v)).toThrow();
});
test("PDF embeds Unicode font, historical timestamps and paginates long unbroken names", async () => {
  const v = closureExportFixture();
  v.report.participants = Array.from({ length: 80 }, (_, i) => ({
    ...v.report.participants[0]!,
    registrationId: String(i),
    firstName: "María Ñúñez " + "Á".repeat(150),
  }));
  const bytes = await renderClosurePdf(v, "informe");
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(doc.getPageCount()).toBeGreaterThan(5);
  expect(doc.getAuthor()).toBe(v.actorName);
  expect(doc.getCreationDate()).toEqual(new Date(v.closedAt));
  expect(doc.getModificationDate()).toEqual(new Date(v.closedAt));
  const unsupported = closureExportFixture();
  unsupported.report.participants[0]!.firstName = "漢字";
  await expect(renderClosurePdf(unsupported, "planilla")).rejects.toMatchObject(
    { code: "PDF_UNSUPPORTED_TEXT" },
  );
});
test("PDF paginates a single participant with 100 components without losing the final rows", async () => {
  const v = closureExportFixture();
  v.report.scheme.components = Array.from({ length: 100 }, (_, order) => ({
    id: String(order),
    name: `Componente sintético ${order + 1}`,
    type: "THEORY" as const,
    weight: "1",
    order,
  }));
  v.report.participants[0]!.grades = v.report.scheme.components.map((c) => ({
    componentId: c.id,
    score: "0",
    revision: 1,
    recordedBy: id,
    recordedAt: v.closedAt,
  }));
  v.report.participants[0]!.result = {
    status: "COMPLETE",
    finalGrade: "0.00",
    decisionGrade: "0.00",
    passed: false,
    missingComponentIds: [],
  };
  const csv = new TextDecoder().decode(renderClosureCsv(v));
  expect(csv).toContain("Componente sintético 100");
  expect(csv).toContain('"0.00"');
  const bytes = await renderClosurePdf(v, "planilla");
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(document.getPageCount()).toBeGreaterThanOrEqual(3);
  expect(bytes).toEqual(await renderClosurePdf(v, "planilla"));
});
test("attendance summary uses persisted participant projection, excluding cancelled session marks", () => {
  const v = closureExportFixture();
  v.report.sessions = [
    {
      id,
      startsAt: v.closedAt,
      endsAt: v.closedAt,
      cancelledAt: v.closedAt,
      cancellationReason: "QA",
      replacementForSessionId: null,
      administrativeReviewRequired: true,
      revision: 1,
      instructorAttendance: {
        status: "PENDING",
        inferred: false,
        markedBy: null,
        markedByName: null,
        markedAt: null,
      },
      participants: [],
    },
  ];
  expect(closureSummary(v.report).join("\n")).toContain(
    "Sesiones efectivas: 0 / Canceladas excluidas: 1",
  );
  expect(closureSummary(v.report).join("\n")).toContain(
    "presentes 1 / ausentes 2",
  );
  expect(() => renderClosureCsv(v)).not.toThrow();
});
test("download adapter uses route version/current actor, fresh loader and safe fixed headers", async () => {
  const ctx = context(),
    repo = repository();
  let call: unknown;
  repo.getVersion = async (...args) => {
    call = args;
    return closureExportFixture();
  };
  const response = await handleClosureDownload(
    ctx,
    "planilla.csv",
    "ADMIN",
    repo,
  );
  expect(call).toEqual([id, id, id, 1]);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Content-Disposition")).toBe(
    'attachment; filename="cierre-v1-planilla.csv"',
  );
  expect(await response.text()).not.toContain("Current actor");
  for (const input of [
    undefined,
    "0",
    "01",
    "1.5",
    "1e2",
    "-1",
    "9007199254740992",
    "1\r\nInjected",
  ])
    expect(() => parseClosureVersion(input)).toThrow();
});
test("download adapter denies missing session, roles, revoked permissions, foreign contexts and missing versions", async () => {
  expect(
    (
      await handleClosureDownload(
        { locals: {}, params: context().params },
        "planilla.csv",
        "ADMIN",
        repository(),
      )
    ).status,
  ).toBe(401);
  const ctx = context();
  ctx.locals.internalUser = { ...actor, roles: ["INSTRUCTOR"] };
  expect(
    (await handleClosureDownload(ctx, "planilla.csv", "ADMIN", repository()))
      .status,
  ).toBe(403);
  for (const code of ["FORBIDDEN", "NOT_FOUND"] as const) {
    const repo = repository();
    repo.getVersion = async () => {
      throw new ClosureError(code, "Unavailable");
    };
    const response = await handleClosureDownload(
      context(),
      "planilla.csv",
      "ADMIN",
      repo,
    );
    expect(response.status).toBe(code === "FORBIDDEN" ? 403 : 404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  }
  const repo = repository();
  repo.getVersion = async () => {
    throw new Error("secret database payload");
  };
  const response = await handleClosureDownload(
    context(),
    "informe.pdf",
    "ADMIN",
    repo,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("secret");
});
