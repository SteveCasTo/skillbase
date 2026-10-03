import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import CourseSelect from "@/components/courses/CourseSelect";

const options = [
  { value: "unassigned", label: "Sin asignar (solo borrador)", disabled: true },
  { value: "registered", label: "Registered instructor" },
];
const render = (
  value: string,
  preserveDisabledValue: boolean,
  disabled = false,
) =>
  renderToStaticMarkup(
    <CourseSelect
      name="instructorId"
      label="Instructor"
      value={value}
      options={options}
      placeholder="Selecciona un instructor"
      required={false}
      preserveDisabledValue={preserveDisabledValue}
      disabled={disabled}
    />,
  );
test("disabled selected placeholder preserves its form value only when explicitly requested", () => {
  expect(render("unassigned", true)).toContain(
    'type="hidden" name="instructorId" value="unassigned"',
  );
  expect(render("unassigned", false)).not.toContain(
    'type="hidden" name="instructorId"',
  );
  expect(render("registered", true)).not.toContain(
    'type="hidden" name="instructorId"',
  );
  expect(render("unassigned", true, true)).not.toContain(
    'type="hidden" name="instructorId"',
  );
});
