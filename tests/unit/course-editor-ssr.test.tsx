import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import CourseImageEditor from "@/components/courses/CourseImageEditor";
import CourseMarkdownEditor from "@/components/courses/CourseMarkdownEditor";

describe("course editor server rendering", () => {
  test("renders the editable Markdown field and preserves saved text", () => {
    const html = renderToStaticMarkup(
      createElement(CourseMarkdownEditor, { value: "## Temario guardado" }),
    );
    expect(html).toContain('name="contentMarkdown"');
    expect(html).toContain('id="contentMarkdown"');
    expect(html).toContain("## Temario guardado");
  });

  test("renders the persisted photo in the editor without browser JavaScript", () => {
    const html = renderToStaticMarkup(
      createElement(CourseImageEditor, {
        currentArtwork: "courses/123/456.webp",
        currentArtworkUrl: "https://example.org/photo.webp",
      }),
    );
    expect(html).toContain('data-course-image-editor="true"');
    expect(html).toContain('src="https://example.org/photo.webp"');
    expect(html).toContain("Foto actual del curso");
  });
});
