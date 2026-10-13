import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultCards } from "@/components/academic-closure/ResultCards";
import { privateClosureReport } from "@/server/academic-closure/projection";
import { closureExportFixture } from "../fixtures/academic-closure-export";

function report(count: number) {
  const value = closureExportFixture().report;
  if (value.access !== "ADMIN")
    throw new Error("Expected private fixture report");
  const hundredths = Math.floor(10_000 / Math.max(count, 1));
  value.scheme.components = Array.from({ length: count }, (_, index) => ({
    id: `component-${index}`,
    name: `Nota ${index + 1}`,
    type: "THEORY" as const,
    weight: (
      (index === count - 1 ? 10_000 - hundredths * (count - 1) : hundredths) /
      100
    ).toFixed(2),
    order: index,
  }));
  value.participants[0]!.grades = value.scheme.components.map((component) => ({
    componentId: component.id,
    score: "0.00",
    revision: 1,
    recordedBy: null,
    recordedAt: null,
  }));
  value.participants[0]!.result = {
    status: "COMPLETE",
    finalGrade: "0.00",
    decisionGrade: "0.00",
    passed: false,
    missingComponentIds: [],
  };
  return value;
}
test("academic result cards always provide a compact expandable summary with complete SSR notes", () => {
  for (const count of [1, 6, 7, 9]) {
    const html = renderToStaticMarkup(<ResultCards report={report(count)} />);
    expect(html).toContain("<details");
    const summary = html.split("</summary>")[0]!;
    expect(summary).toContain(`${count} de ${count} notas calificadas`);
    expect(summary).not.toContain(`Nota ${count}`);
    expect(summary).not.toContain("Saldo informativo");
    expect(summary).not.toContain("Ver detalle");
    expect(html).toContain(`Nota ${count}`);
  }
});
test("academic result cards retain zero grades but never turn incomplete finals or missing components into zero", () => {
  const value = report(8);
  const person = value.participants[0]!;
  person.grades[7]!.score = null;
  person.result = {
    status: "PENDING",
    finalGrade: null,
    decisionGrade: "0.00",
    passed: false,
    missingComponentIds: ["component-7"],
  };
  const html = renderToStaticMarkup(<ResultCards report={value} />);
  expect(html).toContain("7 de 8 notas calificadas");
  expect(html).toContain("Nota final pendiente");
  expect(html).toContain("Pendiente");
  expect(html).toContain("0,00");
  expect(html).not.toContain("Decisión provisional");
  expect(renderToStaticMarkup(<ResultCards report={report(0)} />)).not.toMatch(
    /NaN|Infinity/u,
  );
});
test("academic result card role projections preserve ADMIN identity and exclude instructor private display", () => {
  const value = report(8);
  const admin = renderToStaticMarkup(
    <ResultCards report={privateClosureReport(value, true)} />,
  );
  expect(admin).toContain("001234QA");
  expect(admin).not.toContain("Saldo informativo");
  value.participants[0]!.balanceCents = 5000;
  expect(renderToStaticMarkup(<ResultCards report={value} />)).not.toContain(
    "Saldo informativo",
  );
  const instructor = renderToStaticMarkup(
    <ResultCards report={privateClosureReport(value, false)} />,
  );
  expect(instructor).not.toContain("001234QA");
  expect(instructor).not.toContain("Saldo informativo");
  expect(instructor).toContain("María sintética");
  expect(instructor).toContain("Asistencia no elegible");
  expect(instructor).toContain("racha de 2");
  const person = value.participants[0]!;
  person.result.passed = true;
  person.attendance = {
    ...person.attendance,
    present: 1,
    absent: 4,
    excused: 2,
    pending: 1,
    maximumConsecutiveAbsences: 4,
    academicallyEligible: false,
  };
  const blocked = renderToStaticMarkup(<ResultCards report={value} />);
  expect(blocked).toMatch(/data-variant="default"[^>]*>Aprobado/u);
  expect(blocked).toContain(
    "1 presentes, 4 ausentes, 2 justificadas, 1 pendientes; 8 sesiones en total",
  );
  expect(blocked).toContain("1/8 presentes");
  expect(blocked).toContain("2/8 justificadas");
  expect(blocked).toContain("1/8 pendientes");
  person.attendance.academicallyEligible = true;
  person.result.passed = false;
  const eligible = renderToStaticMarkup(<ResultCards report={value} />);
  expect(eligible).toContain("Asistencia elegible");
  expect(eligible).toMatch(/data-variant="destructive"[^>]*>No aprobado/u);
  expect(eligible).not.toContain("racha de");
  person.result.finalGrade = "54.25";
  const insufficient = renderToStaticMarkup(<ResultCards report={value} />);
  expect(insufficient).toContain("54,25");
  expect(insufficient).toContain("Mín. 70");
  expect(insufficient).not.toContain("racha de");
  person.attendance = {
    ...person.attendance,
    present: 0,
    absent: 0,
    excused: 0,
    pending: 0,
    maximumConsecutiveAbsences: 0,
  };
  const empty = renderToStaticMarkup(<ResultCards report={value} />);
  expect(empty).toContain("sin sesiones computables");
  expect(empty).not.toMatch(/NaN|Infinity|racha de/u);
});
