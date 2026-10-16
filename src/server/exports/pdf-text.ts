import type { PDFFont } from "pdf-lib";

export class PdfTextError extends Error {
  readonly code = "PDF_UNSUPPORTED_TEXT";
  constructor() {
    super(
      "La fuente del PDF no admite algunos caracteres. Exporta CSV para conservar el texto completo.",
    );
    this.name = "RegistrationPdfTextError";
  }
}
const segmenter = new Intl.Segmenter("es", { granularity: "grapheme" });
/** Measure actual font glyphs, retaining every grapheme without ellipsis. */
export function wrapPdfText(
  text: string,
  font: PDFFont,
  width: number,
  supported: ReadonlySet<number> = new Set(font.getCharacterSet()),
  size = 8.5,
): string[] {
  for (const character of text) {
    if (character !== "\n" && !supported.has(character.codePointAt(0) ?? -1))
      throw new PdfTextError();
  }
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const graphemes = [...segmenter.segment(paragraph)].map(
      ({ segment }) => segment,
    );
    if (!graphemes.length) lines.push("");
    let offset = 0;
    while (offset < graphemes.length) {
      let low = 1;
      let high = graphemes.length - offset;
      let length = 0;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (
          font.widthOfTextAtSize(
            graphemes.slice(offset, offset + middle).join(""),
            size,
          ) <= width
        ) {
          length = middle;
          low = middle + 1;
        } else high = middle - 1;
      }
      if (!length) throw new PdfTextError();
      if (offset + length < graphemes.length) {
        const boundary = graphemes
          .slice(offset, offset + length)
          .lastIndexOf(" ");
        if (boundary > 0) length = boundary + 1;
      }
      lines.push(graphemes.slice(offset, offset + length).join(""));
      offset += length;
    }
  }
  return lines;
}
