import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import { assertCents } from "@/domain/pre-registrations/money";
import type { AdminRegistrationDto } from "@/domain/pre-registrations/types";
import {
  FINANCE_LABELS,
  MEMBERSHIP_LABELS,
  MONEY_COLUMNS,
  PARTICIPANT_LABELS,
  registrationAmounts,
  registrationDisplayNames,
} from "./columns";
import fontAsset from "./fonts/noto-sans-regular.json";

const WIDTH = 841.89;
const HEIGHT = 595.28;
const MARGIN = 36;
const FONT_SIZE = 8;
const LINE_HEIGHT = 12;
const COLUMN_WIDTHS = [210, 100, 92, 92, 92, 92, 91.89];
const INK = rgb(0.15, 0.17, 0.2);
const MUTED = rgb(0.35, 0.37, 0.4);
const RULE = rgb(0.8, 0.82, 0.84);
const segmenter = new Intl.Segmenter("es", { granularity: "grapheme" });

export class RegistrationPdfTextError extends Error {
  readonly code = "PDF_UNSUPPORTED_TEXT";
  constructor() {
    super(
      "La fuente del PDF no admite algunos caracteres. Exporta CSV para conservar el texto completo.",
    );
    this.name = "RegistrationPdfTextError";
  }
}

/** Never truncate names/CI or silently replace missing glyphs. The bundled Noto
 * font supports Latin, Greek and Cyrillic; other scripts may require CSV.
 */
export function wrapPdfText(
  text: string,
  font: PDFFont,
  width: number,
  supported: ReadonlySet<number> = new Set(font.getCharacterSet()),
): string[] {
  for (const character of text) {
    if (character !== "\n" && !supported.has(character.codePointAt(0) ?? -1))
      throw new RegistrationPdfTextError();
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
      // Measure shaped strings, not guessed character widths, with logarithmic
      // probes instead of reshaping every growing prefix on every PDF page.
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = graphemes.slice(offset, offset + middle).join("");
        if (font.widthOfTextAtSize(candidate, FONT_SIZE) <= width) {
          length = middle;
          low = middle + 1;
        } else high = middle - 1;
      }
      if (!length) throw new RegistrationPdfTextError();
      lines.push(graphemes.slice(offset, offset + length).join(""));
      offset += length;
    }
  }
  return lines;
}

function totals(rows: readonly AdminRegistrationDto[]): string {
  return MONEY_COLUMNS.map((column) => {
    const cents = rows.reduce((sum, row) => {
      const amount = column.value(row);
      assertCents(amount);
      return sum + BigInt(amount);
    }, 0n);
    return `${column.label}: ${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  }).join("   |   ");
}

export async function renderRegistrationsPdf(
  rows: readonly AdminRegistrationDto[],
  generatedAt: Date,
): Promise<Uint8Array> {
  const civil = instantToBoliviaCivil(generatedAt).replace("T", " ");
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  // JSON import embeds these bytes in the SSR bundle: no runtime fetch, OS font,
  // fs tracing requirement, public asset URL or temporary PII file.
  const font = await document.embedFont(
    Uint8Array.from(Buffer.from(fontAsset.base64, "base64")),
    { subset: true },
  );
  document.setTitle("Preinscripciones — listado administrativo");
  document.setAuthor("SkillBase");
  document.setCreator("SkillBase");
  document.setProducer("SkillBase");
  document.setCreationDate(generatedAt);
  document.setModificationDate(generatedAt);
  document.setLanguage("es-BO");
  let page: PDFPage;
  let y = 0;
  const summary = totals(rows);
  const supported = new Set(font.getCharacterSet());
  // Request-local only: repeated headings/amounts are laid out once. Neither
  // participant text nor document objects are cached between exports.
  const wrapping = new Map<string, string[]>();
  function wrap(value: string, width: number): string[] {
    const key = JSON.stringify([width, value]);
    const cached = wrapping.get(key);
    if (cached) return cached;
    const lines = wrapPdfText(value, font, width, supported);
    wrapping.set(key, lines);
    return lines;
  }

  function text(value: string, x: number, top: number, size = FONT_SIZE) {
    page.drawText(value, { x, y: top, size, font, color: INK });
  }
  function newPage(row?: AdminRegistrationDto) {
    page = document.addPage([WIDTH, HEIGHT]);
    text("SkillBase / Preinscripciones", MARGIN, HEIGHT - 48, 20);
    text(
      `Listado administrativo privado · ${rows.length} registros · ${civil} (Bolivia UTC-04)`,
      MARGIN,
      HEIGHT - 69,
      9,
    );
    y = HEIGHT - 88;
    for (const line of wrap(summary, WIDTH - 2 * MARGIN)) {
      text(line, MARGIN, y);
      y -= LINE_HEIGHT;
    }
    text(
      "Pagado y devuelto son movimientos acumulados; este listado no es una boleta ni un recibo.",
      MARGIN,
      y,
    );
    y -= 24;
    if (row) {
      const names = registrationDisplayNames(row);
      for (const line of wrap(
        `Curso: ${names.course}\nGrupo: ${names.group}`,
        WIDTH - 2 * MARGIN,
      )) {
        text(line, MARGIN, y);
        y -= LINE_HEIGHT;
      }
      y -= 10;
    }
    let x = MARGIN;
    for (const [index, heading] of [
      "Participante / CI / categoría",
      "Estado / financiero",
      ...MONEY_COLUMNS.map((column) => column.label),
    ].entries()) {
      text(heading, x + 4, y);
      x += COLUMN_WIDTHS[index] ?? 0;
    }
    page.drawLine({
      start: { x: MARGIN, y: y - 6 },
      end: { x: WIDTH - MARGIN, y: y - 6 },
      color: RULE,
      thickness: 0.7,
    });
    y -= 22;
  }

  let courseId: string | undefined;
  let groupId: string | undefined;
  if (!rows.length) {
    newPage();
    text("No hay registros que coincidan con los filtros.", MARGIN, y);
  }
  for (const row of rows) {
    const values = [
      `${row.participant.firstName}\n${row.participant.lastName}\nCI: ${row.participant.ci} · ${PARTICIPANT_LABELS[row.price.participantType]}`,
      `${MEMBERSHIP_LABELS[row.membershipStatus]}\n${FINANCE_LABELS[row.financialStatus]}`,
      ...registrationAmounts(row),
    ];
    const cells = values.map((value, index) =>
      wrap(value, (COLUMN_WIDTHS[index] ?? 0) - 8),
    );
    const height =
      Math.max(...cells.map((cell) => cell.length)) * LINE_HEIGHT + 10;
    if (height > 300) throw new RegistrationPdfTextError();
    if (
      courseId !== row.courseId ||
      groupId !== row.groupId ||
      y - height < 55
    ) {
      courseId = row.courseId;
      groupId = row.groupId;
      newPage(row);
    }
    if (y - height < 55) throw new RegistrationPdfTextError();
    let x = MARGIN;
    for (const [index, lines] of cells.entries()) {
      for (const [lineIndex, line] of lines.entries())
        text(line, x + 4, y - lineIndex * LINE_HEIGHT);
      x += COLUMN_WIDTHS[index] ?? 0;
    }
    y -= height;
    page!.drawLine({
      start: { x: MARGIN, y: y + 7 },
      end: { x: WIDTH - MARGIN, y: y + 7 },
      color: RULE,
      thickness: 0.3,
    });
  }
  for (const [index, current] of document.getPages().entries()) {
    current.drawText(
      `Uso exclusivo ADMIN · Página ${index + 1} de ${document.getPageCount()}`,
      { x: MARGIN, y: 28, size: 8, font, color: MUTED },
    );
  }
  return document.save();
}
