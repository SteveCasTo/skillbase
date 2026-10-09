import type { PDFFont, PDFPage } from "pdf-lib";
import { rgb } from "pdf-lib";
import { CertificatePdfError } from "./types";

const segmenter = new Intl.Segmenter("es", { granularity: "grapheme" });

export interface TextBox {
  x: number;
  top: number;
  width: number;
  height: number;
  size: number;
  minimumSize: number;
  align?: "left" | "center";
  color?: ReturnType<typeof rgb>;
}

function linesFor(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/ +/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      if (font.widthOfTextAtSize(word, size) <= width) {
        line = word;
        continue;
      }
      const graphemes = [...segmenter.segment(word)].map(
        ({ segment }) => segment,
      );
      let offset = 0;
      while (offset < graphemes.length) {
        let low = 1;
        let high = graphemes.length - offset;
        let count = 0;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          if (
            font.widthOfTextAtSize(
              graphemes.slice(offset, offset + middle).join(""),
              size,
            ) <= width
          ) {
            count = middle;
            low = middle + 1;
          } else high = middle - 1;
        }
        if (!count)
          throw new CertificatePdfError(
            "PDF_TEXT_OVERFLOW",
            "El texto no cabe en la plantilla.",
          );
        line = graphemes.slice(offset, offset + count).join("");
        offset += count;
        if (offset < graphemes.length) {
          lines.push(line);
          line = "";
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Bounded fit: wrap at words/graphemes, shrink only to a readable floor, then
 * fail explicitly. Never truncate an identity or spill onto signatures/page 2. */
export function fitCertificateText(text: string, font: PDFFont, box: TextBox) {
  const supported = new Set(font.getCharacterSet());
  for (const character of text) {
    if (character !== "\n" && !supported.has(character.codePointAt(0)!))
      throw new CertificatePdfError(
        "PDF_UNSUPPORTED_TEXT",
        "La fuente del certificado no admite algunos caracteres.",
      );
  }
  const layoutAt = (size: number) => {
    const lines = linesFor(text, font, size, box.width);
    const lineHeight = size * 1.35;
    return { lines, size, lineHeight };
  };
  const fits = (layout: ReturnType<typeof layoutAt>) =>
    layout.lines.length * layout.lineHeight <= box.height;
  const preferred = layoutAt(box.size);
  if (fits(preferred)) return preferred;
  let best = layoutAt(box.minimumSize);
  if (!fits(best))
    throw new CertificatePdfError(
      "PDF_TEXT_OVERFLOW",
      "El texto es demasiado extenso para esta plantilla de una página.",
    );
  let low = 1;
  let high = Math.floor((box.size - box.minimumSize) * 4);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = layoutAt(box.minimumSize + middle * 0.25);
    if (fits(candidate)) {
      best = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }
  return best;
}

export function drawCertificateText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  box: TextBox,
) {
  const layout = fitCertificateText(text, font, box);
  const height = page.getHeight();
  for (const [index, line] of layout.lines.entries()) {
    const offset =
      box.align === "center"
        ? (box.width - font.widthOfTextAtSize(line, layout.size)) / 2
        : 0;
    page.drawText(line, {
      font,
      size: layout.size,
      x: box.x + offset,
      y: height - box.top - layout.size - index * layout.lineHeight,
      color: box.color ?? rgb(0, 0, 0),
    });
  }
  return layout;
}
