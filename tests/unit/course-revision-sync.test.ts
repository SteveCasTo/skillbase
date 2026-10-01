import { expect, test } from "bun:test";
import { synchronizeCourseRevision } from "@/components/courses/course-mutation-lock";

test("confirmed revisions synchronize only forms belonging to the same course", () => {
  const editor = { value: "old" };
  const editorial = { value: "old" };
  const foreign = { value: "other revision" };
  const group = { value: "group revision" };
  const forms = [
    {
      dataset: { courseId: "course-a", courseMutationId: "course-a" },
      querySelectorAll: () => [editor],
    },
    {
      dataset: { courseMutationId: "course-a" },
      querySelectorAll: () => [editorial],
    },
    {
      dataset: { courseMutationId: "course-b" },
      querySelectorAll: () => [foreign],
    },
    { dataset: { courseId: "course-a" }, querySelectorAll: () => [group] },
  ];
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { querySelectorAll: () => forms },
  });
  try {
    synchronizeCourseRevision("course-a", "2026-09-30T00:00:00.001Z");
    expect(editor.value).toBe("2026-09-30T00:00:00.001Z");
    expect(editorial.value).toBe(editor.value);
    expect(foreign.value).toBe("other revision");
    expect(group.value).toBe("group revision");
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
