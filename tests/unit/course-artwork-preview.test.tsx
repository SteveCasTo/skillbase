import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import CourseArtworkPreview from "../../src/components/courses/CourseArtworkPreview";

describe("course artwork preview", () => {
  it("renders the exported crop with labeled public contexts", () => {
    const html = renderToStaticMarkup(
      <CourseArtworkPreview src="blob:prepared-artwork" />,
    );

    expect(html).toContain('src="blob:prepared-artwork"');
    expect(html).toContain('aria-label="Vistas previas públicas"');
    expect(html).toContain('aria-pressed="true"');
    for (const label of ["Destacado", "Afiches", "Móvil", "Detalle"])
      expect(html).toContain(`>${label}</button>`);
    expect(html).not.toContain("Vista orientativa");
  });

  it("does not show a stale crop while the preview is being regenerated", () => {
    const html = renderToStaticMarkup(<CourseArtworkPreview src={null} />);

    expect(html).toContain("Actualizando vista previa");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("<img");
  });
});
