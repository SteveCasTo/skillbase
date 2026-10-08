import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ResultCards,
  VISIBLE_RESULT_COMPONENTS,
} from "@/components/academic-closure/ResultCards";
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
test("academic result cards expose six grades directly and use expandable SSR details from seven", () => {
  expect(VISIBLE_RESULT_COMPONENTS).toBe(6);
  const direct = renderToStaticMarkup(<ResultCards report={report(6)} />);
  expect(direct).toContain("Nota 6");
  expect(direct).not.toContain("<details");
  const detailed = renderToStaticMarkup(<ResultCards report={report(7)} />);
  expect(detailed).toContain("<details");
  expect(detailed).toContain("7/7");
  expect(detailed).toContain("Nota 7");
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
  expect(html).toContain("7/8");
  expect(html).toContain("Resultado pendiente");
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
  expect(admin).toContain("Saldo informativo");
  const instructor = renderToStaticMarkup(
    <ResultCards report={privateClosureReport(value, false)} />,
  );
  expect(instructor).not.toContain("001234QA");
  expect(instructor).not.toContain("Saldo informativo");
  expect(instructor).toContain("María sintética");
  expect(instructor).toContain("No elegible");
});
