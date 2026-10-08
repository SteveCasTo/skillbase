import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GradeRow } from "@/components/evaluations/GradeRow";
import { changedGrades, gradeDrafts } from "@/components/evaluations/editing";
import { closureExportFixture } from "../fixtures/academic-closure-export";

test("grade editing sends changed components together, leaves untouched pending empty and rejects deleting persisted zero", () => {
  const drafts = gradeDrafts(
    ["stored", "changed", "pending"],
    [
      {
        componentId: "stored",
        score: "0.00",
        revision: 2,
        recordedBy: null,
        recordedAt: null,
      },
    ],
  );
  drafts[1]!.score = "80";
  expect(changedGrades(drafts)).toEqual({
    grades: [{ componentId: "changed", gradeRevision: 0, score: "80" }],
    errors: {},
  });
  drafts[0]!.score = "";
  expect(changedGrades(drafts).errors.stored).toContain("No puedes borrar");
  drafts[0]!.score = "5";
  expect(
    changedGrades(drafts).grades.map((entry) => entry.componentId),
  ).toEqual(["stored", "changed"]);
});
test("pending grade rows have only component pending labels and one participant pencil, while closed rows have no editor", () => {
  const value = closureExportFixture().report;
  const person = value.participants[0]!;
  person.canGrade = true;
  person.grades[0]!.score = null;
  person.result = {
    status: "PENDING",
    finalGrade: null,
    decisionGrade: "0.00",
    passed: false,
    missingComponentIds: [person.grades[0]!.componentId],
  };
  const render = () =>
    renderToStaticMarkup(
      <GradeRow
        courseId={value.courseId}
        participant={person}
        components={value.scheme.components}
        schemeRevision={1}
        pending={false}
        save={async () => {
          throw new Error("Unexpected mutation");
        }}
      />,
    );
  const html = render();
  expect(html.match(/Pendiente/gu)).toHaveLength(1);
  expect(html.match(/aria-label="Editar notas de/gu)).toHaveLength(1);
  person.canGrade = false;
  expect(render()).not.toContain("Editar notas de");
});
