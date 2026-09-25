import { describe, expect, test } from "bun:test";
import { applyMarkdownAction } from "../../src/components/courses/course-markdown-actions";

describe("course Markdown toolbar actions", () => {
  test("wraps selected text with supported inline Markdown", () => {
    expect(applyMarkdownAction("un texto", 3, 8, "bold")).toEqual({
      value: "un **texto**",
      selectionStart: 5,
      selectionEnd: 10,
    });
    expect(applyMarkdownAction("hola", 0, 4, "italic").value).toBe("*hola*");
    expect(applyMarkdownAction("código", 0, 6, "code").value).toBe("`código`");
    expect(applyMarkdownAction("curso", 0, 5, "link").value).toBe(
      "[curso](https://)",
    );
  });

  test("inserts heading and inline placeholders at the caret", () => {
    expect(applyMarkdownAction("Texto", 0, 0, "heading")).toEqual({
      value: "## TítuloTexto",
      selectionStart: 3,
      selectionEnd: 9,
    });
    expect(applyMarkdownAction("", 0, 0, "bold")).toEqual({
      value: "**texto**",
      selectionStart: 2,
      selectionEnd: 7,
    });
    expect(applyMarkdownAction("", 0, 0, "link")).toEqual({
      value: "[Texto del enlace](https://)",
      selectionStart: 19,
      selectionEnd: 27,
    });
  });

  test("prefixes selected lines with parser-supported list syntax", () => {
    expect(applyMarkdownAction("uno\ndos", 0, 7, "ordered-list").value).toBe(
      "1. uno\n2. dos",
    );
    expect(applyMarkdownAction("", 0, 0, "unordered-list").value).toBe(
      "- Elemento",
    );
  });
});
