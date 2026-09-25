import { describe, expect, test } from "bun:test";
import { parseCourseMarkdown } from "@/components/public-courses/course-markdown";

describe("course Markdown", () => {
  test("parses headings, lists, emphasis and safe links", () => {
    const nodes = parseCourseMarkdown(
      "## Temario\n\n- **Fundamentos**\n- [Guía](https://example.com/guia)",
    );

    expect(nodes.map((node) => node.type)).toEqual([
      "heading",
      "unordered-list",
    ]);
    expect(nodes[0]!.level).toBe(2);
    expect(nodes[1]!.children?.[0]!.children?.[0]!.type).toBe("strong");
    expect(nodes[1]!.children?.[1]!.children?.[0]).toMatchObject({
      type: "link",
      href: "https://example.com/guia",
    });
  });

  test("keeps raw HTML as inert text and removes unsafe link destinations", () => {
    const nodes = parseCourseMarkdown(
      '<img src=x onerror="alert(1)"> [ejecutar](javascript:alert(1))',
    );

    expect(nodes[0]!.children?.[0]).toMatchObject({
      type: "text",
      value: '<img src=x onerror="alert(1)"> ',
    });
    expect(nodes[0]!.children?.[1]).toMatchObject({
      type: "text",
      value: "ejecutar",
    });
    expect(nodes[0]!.children?.some((node) => node.type === "link")).toBe(
      false,
    );
  });
});
