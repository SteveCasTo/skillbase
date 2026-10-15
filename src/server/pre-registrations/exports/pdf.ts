import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import type { RegistrationFilter } from "@/domain/pre-registrations/types";
import type { RegistrationExportRow } from "@/application/pre-registrations/export-finance";
import {
  FINANCE_LABELS,
  MEMBERSHIP_LABELS,
  MONEY_COLUMNS,
  PARTICIPANT_LABELS,
  NET_COLUMNS,
  reportDecimal,
  registrationDisplayNames,
} from "./columns";
import fontAsset from "./fonts/noto-sans-regular.json";

const WIDTH = 841.89;
const HEIGHT = 595.28;
const MARGIN = 36;
const FONT_SIZE = 8;
const LINE_HEIGHT = 12;
const COLUMN_WIDTHS = [210, 112, 72, 72, 72, 84, 76, 71.89];
const INK = rgb(0.15, 0.17, 0.2);
const MUTED = rgb(0.35, 0.37, 0.4);
const RULE = rgb(0.8, 0.82, 0.84);
const ACCENT = rgb(0.73, 0.3, 0.19);
const WASH = rgb(0.97, 0.96, 0.95);
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
  size = FONT_SIZE,
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
        if (font.widthOfTextAtSize(candidate, size) <= width) {
          length = middle;
          low = middle + 1;
        } else high = middle - 1;
      }
      if (!length) throw new RegistrationPdfTextError();
      // Prefer whole words while retaining every space and grapheme verbatim.
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

export async function renderRegistrationsPdf(
  rows: readonly RegistrationExportRow[],
  generatedAt: Date,
  filter?: RegistrationFilter,
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
  const supported = new Set(font.getCharacterSet());
  // Request-local only: repeated headings/amounts are laid out once. Neither
  // participant text nor document objects are cached between exports.
  const wrapping = new Map<string, string[]>();
  function wrap(value: string, width: number, size = FONT_SIZE): string[] {
    const key = JSON.stringify([width, size, value]);
    const cached = wrapping.get(key);
    if (cached) return cached;
    const lines = wrapPdfText(value, font, width, supported, size);
    wrapping.set(key, lines);
    return lines;
  }

  function text(
    value: string,
    x: number,
    top: number,
    size = FONT_SIZE,
    color = INK,
  ) {
    page.drawText(value, { x, y: top, size, font, color });
  }
  function rule(top: number, color = RULE, thickness = 0.5) {
    page.drawLine({
      start: { x: MARGIN, y: top },
      end: { x: WIDTH - MARGIN, y: top },
      color,
      thickness,
    });
  }
  function summary() {
    text(
      `Resumen del alcance · ${rows.length} ${rows.length === 1 ? "preinscripción" : "preinscripciones"} · Importes en BOB`,
      MARGIN,
      y,
      10,
    );
    y -= 18;
    for (const columns of [MONEY_COLUMNS, NET_COLUMNS]) {
      const width = (WIDTH - 2 * MARGIN) / columns.length;
      for (const [i, column] of columns.entries()) {
        const x = MARGIN + i * width;
        const amount = rows.reduce(
          (sum, row) => sum + BigInt(column.value(row)),
          0n,
        );
        text(column.label, x, y, 8, MUTED);
        text(reportDecimal(amount), x, y - 19, 13);
      }
      y -= 46;
    }
    rule(y + 5);
    y -= 10;
  }
  const scope = [
    filter?.courseId ? "Curso filtrado" : "Todos los cursos",
    filter?.groupId ? "Grupo filtrado" : "Todos los grupos",
    filter?.membershipStatus
      ? `Estado: ${MEMBERSHIP_LABELS[filter.membershipStatus]}`
      : "Todos los estados",
    filter?.financialStatus
      ? `Finanzas: ${FINANCE_LABELS[filter.financialStatus]}`
      : "Todos los estados financieros",
    filter?.search ? `Búsqueda: ${filter.search}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const headings = [
    "Participante / CI / categoría",
    "Estado / financiero",
    "Precio BOB",
    "Efectivo neto\nBOB",
    "QR neto\nBOB",
    "No registrado\nneto BOB",
    "Recibido neto\nBOB",
    "Saldo BOB",
  ];
  function newPage(row?: RegistrationExportRow) {
    page = document.addPage([WIDTH, HEIGHT]);
    const firstPage = document.getPageCount() === 1;
    text(
      "Departamento de Informática y Sistemas · FCyT · UMSS",
      MARGIN,
      HEIGHT - 36,
      9,
      MUTED,
    );
    text("Preinscripciones", MARGIN, HEIGHT - 66, firstPage ? 23 : 16);
    text(
      `Informe financiero · ${civil} (Bolivia UTC-04)`,
      MARGIN,
      HEIGHT - 85,
      9,
      MUTED,
    );
    rule(HEIGHT - 98, ACCENT, 1.5);
    y = HEIGHT - 116;
    for (const line of wrap(`Filtros: ${scope}`, WIDTH - 2 * MARGIN)) {
      text(line, MARGIN, y, 8, MUTED);
      y -= LINE_HEIGHT;
    }
    y -= 12;
    if (firstPage) summary();
    if (row) {
      const names = registrationDisplayNames(row);
      for (const line of wrap(
        `Curso: ${names.course}\nGrupo: ${names.group}`,
        WIDTH - 2 * MARGIN,
      )) {
        text(line, MARGIN, y);
        y -= LINE_HEIGHT;
      }
      y -= 12;
    }
    page.drawRectangle({
      x: MARGIN,
      y: y - 27,
      width: WIDTH - 2 * MARGIN,
      height: 40,
      color: WASH,
    });
    let x = MARGIN;
    for (const [index, heading] of headings.entries()) {
      for (const [lineIndex, line] of heading.split("\n").entries())
        text(line, x + 6, y - lineIndex * 11);
      x += COLUMN_WIDTHS[index] ?? 0;
    }
    rule(y - 27);
    y -= 44;
  }

  let courseId: string | undefined;
  let groupId: string | undefined;
  if (!rows.length) {
    newPage();
    text("No hay registros que coincidan con los filtros.", MARGIN, y);
  }
  // Keep each course/group together even when creation timestamps interleave.
  const groups = new Map<string, RegistrationExportRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.courseId, row.groupId]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const row of [...groups.values()].flat()) {
    const values = [
      `${row.participant.firstName}\n${row.participant.paternalSurname} ${row.participant.maternalSurname}\nCI: ${row.participant.ci} · ${PARTICIPANT_LABELS[row.price.participantType]}`,
      `${MEMBERSHIP_LABELS[row.membershipStatus]}\n${FINANCE_LABELS[row.financialStatus]}`,
      reportDecimal(row.price.totalPriceCents),
      ...NET_COLUMNS.map((column) => reportDecimal(column.value(row))),
      reportDecimal(row.balanceCents),
    ];
    const cells = values.map((value, index) =>
      index < 2 ? wrap(value, (COLUMN_WIDTHS[index] ?? 0) - 12) : [value],
    );
    const details = wrap(
      `Pagado: ${reportDecimal(row.paidCents)} BOB · Devuelto: ${reportDecimal(row.refundedCents)} BOB · Por devolver: ${reportDecimal(row.refundDueCents)} BOB · Responsable del registro: ${row.registeredByName?.trim() || "No registrado"}`,
      WIDTH - 2 * MARGIN - 12,
    );
    const height =
      Math.max(...cells.map((cell) => cell.length)) * LINE_HEIGHT +
      details.length * LINE_HEIGHT +
      21;
    if (height > 300) throw new RegistrationPdfTextError();
    if (
      courseId !== row.courseId ||
      groupId !== row.groupId ||
      y - height < 66
    ) {
      courseId = row.courseId;
      groupId = row.groupId;
      newPage(row);
    }
    // A long but valid first row can outgrow the overview page; continue it
    // intact after the overview instead of truncating identity or amounts.
    if (y - height < 66 && document.getPageCount() === 1) newPage(row);
    if (y - height < 66) throw new RegistrationPdfTextError();
    let x = MARGIN;
    for (const [index, lines] of cells.entries()) {
      for (const [lineIndex, line] of lines.entries()) {
        const width = (COLUMN_WIDTHS[index] ?? 0) - 12;
        const size =
          index < 2
            ? FONT_SIZE
            : Math.min(
                FONT_SIZE,
                (FONT_SIZE * width) / font.widthOfTextAtSize(line, FONT_SIZE),
              );
        text(
          line,
          index < 2
            ? x + 6
            : x +
                (COLUMN_WIDTHS[index] ?? 0) -
                6 -
                font.widthOfTextAtSize(line, size),
          y - lineIndex * LINE_HEIGHT,
          size,
        );
      }
      x += COLUMN_WIDTHS[index] ?? 0;
    }
    const detailY =
      y - Math.max(...cells.map((cell) => cell.length)) * LINE_HEIGHT - 3;
    for (const [i, line] of details.entries())
      text(line, MARGIN + 6, detailY - i * LINE_HEIGHT, FONT_SIZE, MUTED);
    y -= height;
    rule(y + 10, RULE, 0.3);
  }
  for (const [index, current] of document.getPages().entries()) {
    current.drawText(
      "Estado vivo · Netos = pagos menos devoluciones por método. No registrado = método sin registro.",
      { x: MARGIN, y: 49, size: 7.5, font, color: MUTED },
    );
    current.drawText(
      "Pagado y devuelto son acumulados. No es boleta, recibo ni acta de cierre académico.",
      { x: MARGIN, y: 38, size: 7.5, font, color: MUTED },
    );
    current.drawText(
      `Uso exclusivo ADMIN · Página ${index + 1} de ${document.getPageCount()}`,
      { x: MARGIN, y: 21, size: 8, font, color: MUTED },
    );
  }
  return document.save();
}
