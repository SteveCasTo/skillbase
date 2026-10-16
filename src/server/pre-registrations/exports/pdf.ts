import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFPage, rgb } from "pdf-lib";
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
const MARGIN = 28;
const CONTENT_WIDTH = WIDTH - 2 * MARGIN;
const FOOTER_TOP = 42;
const FONT_SIZE = 8.5;
const SECONDARY_SIZE = 7.5;
const LINE_HEIGHT = 11;
const CELL_PADDING = 5;
const INK = rgb(0.15, 0.17, 0.2);
const MUTED = rgb(0.35, 0.37, 0.4);
const RULE = rgb(0.8, 0.82, 0.84);
const ACCENT = rgb(0.73, 0.3, 0.19);
const WASH = rgb(0.97, 0.96, 0.95);
import {
  PdfTextError as RegistrationPdfTextError,
  wrapPdfText,
} from "@/server/exports/pdf-text";
export {
  PdfTextError as RegistrationPdfTextError,
  wrapPdfText,
} from "@/server/exports/pdf-text";

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
  function rightText(
    value: string,
    right: number,
    top: number,
    size = FONT_SIZE,
  ) {
    text(value, right - font.widthOfTextAtSize(value, size), top, size);
  }
  // Every amount has a column, including zero refunds and signed method nets.
  // Measure the actual amounts before assigning the remaining width to identity;
  // never squeeze a long amount into an unreadably small font.
  const amountColumns = [
    { heading: "Precio", ...MONEY_COLUMNS[0] },
    { heading: "Pagado", ...MONEY_COLUMNS[1] },
    { heading: "Devuelto", ...MONEY_COLUMNS[3] },
    { heading: "Por\ndevolver", ...MONEY_COLUMNS[4] },
    { heading: "Efectivo\nneto", ...NET_COLUMNS[0] },
    { heading: "QR\nneto", ...NET_COLUMNS[1] },
    { heading: "Sin método\nneto", ...NET_COLUMNS[2] },
    { heading: "Recibido\nneto", ...NET_COLUMNS[3] },
    { heading: "Saldo", ...MONEY_COLUMNS[2] },
  ];
  const amountWidths = amountColumns.map((column) =>
    Math.ceil(
      Math.max(
        ...column.heading
          .split("\n")
          .map((line) => font.widthOfTextAtSize(line, FONT_SIZE)),
        ...Array.from(
          new Set(rows.map((row) => reportDecimal(column.value(row)))),
          (amount) => font.widthOfTextAtSize(amount, FONT_SIZE),
        ),
      ) +
        2 * CELL_PADDING,
    ),
  );
  const statusWidth = 88;
  const identityWidth =
    CONTENT_WIDTH -
    statusWidth -
    amountWidths.reduce((sum, width) => sum + width, 0);
  if (identityWidth < 180) throw new RegistrationPdfTextError();
  const columnWidths = [identityWidth, statusWidth, ...amountWidths];
  const headings = [
    "Participante / CI / categoría",
    "Estado /\nfinanciero",
    ...amountColumns.map((column) => column.heading),
  ];

  function summary() {
    const summaryRows = [
      [
        MONEY_COLUMNS[0],
        MONEY_COLUMNS[1],
        MONEY_COLUMNS[3],
        MONEY_COLUMNS[2],
        MONEY_COLUMNS[4],
      ],
      [NET_COLUMNS[3], NET_COLUMNS[0], NET_COLUMNS[1], NET_COLUMNS[2]],
    ];
    for (const columns of summaryRows) {
      const width = CONTENT_WIDTH / columns.length;
      for (const [i, column] of columns.entries()) {
        const label = column.label
          .replace(" BOB", "")
          .replace("No registrado", "Sin método");
        const amount = reportDecimal(
          rows.reduce((sum, row) => sum + BigInt(column.value(row)), 0n),
        );
        const x = MARGIN + i * width;
        // Large aggregate values can wrap the label, never the monetary value.
        const amountWidth = font.widthOfTextAtSize(amount, 11);
        const labelWidth = width - amountWidth - 16;
        if (labelWidth < 30) throw new RegistrationPdfTextError();
        const lines = wrap(label, labelWidth, 8);
        for (const [lineIndex, line] of lines.entries())
          text(line, x, y - lineIndex * 10, 8, MUTED);
        rightText(amount, x + width - 12, y, 11);
      }
      y -= 26;
    }
    rule(y + 7);
    y -= 8;
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
  function newPage() {
    page = document.addPage([WIDTH, HEIGHT]);
    const firstPage = document.getPageCount() === 1;
    text(
      "Departamento de Informática y Sistemas · FCyT · UMSS",
      MARGIN,
      HEIGHT - 28,
      8,
      MUTED,
    );
    text("Preinscripciones", MARGIN, HEIGHT - 51, 18);
    rightText(
      `Informe financiero · ${civil} (Bolivia UTC-04)`,
      WIDTH - MARGIN,
      HEIGHT - 48,
      8.5,
    );
    y = HEIGHT - 69;
    for (const line of wrap(
      `${rows.length} ${rows.length === 1 ? "preinscripción" : "preinscripciones"} · Importes en BOB · ${scope}`,
      CONTENT_WIDTH,
      8,
    )) {
      text(line, MARGIN, y, 8, MUTED);
      y -= LINE_HEIGHT;
    }
    rule(y + 3, ACCENT, 1);
    y -= 14;
    if (firstPage) summary();
  }

  function groupHeading(row: RegistrationExportRow) {
    const names = registrationDisplayNames(row);
    const course = wrap(`Curso: ${names.course}`, CONTENT_WIDTH, 10);
    const group = wrap(`Grupo: ${names.group}`, CONTENT_WIDTH, 8);
    return {
      course,
      group,
      height: course.length * 13 + group.length * 11 + 10,
    };
  }
  function tableHeading(row: RegistrationExportRow) {
    const { course, group } = groupHeading(row);
    for (const line of course) {
      text(line, MARGIN, y, 10);
      y -= 13;
    }
    for (const line of group) {
      text(line, MARGIN, y, 8, MUTED);
      y -= 11;
    }
    y -= 10;
    page.drawRectangle({
      x: MARGIN,
      y: y - 19,
      width: CONTENT_WIDTH,
      height: 30,
      color: WASH,
    });
    let x = MARGIN;
    for (const [index, heading] of headings.entries()) {
      for (const [lineIndex, line] of heading.split("\n").entries())
        if (index < 2)
          text(line, x + CELL_PADDING, y - lineIndex * LINE_HEIGHT);
        else
          rightText(
            line,
            x + columnWidths[index]! - CELL_PADDING,
            y - lineIndex * LINE_HEIGHT,
          );
      x += columnWidths[index]!;
    }
    rule(y - 19);
    y -= 34;
  }

  newPage();
  if (!rows.length) {
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
  for (const group of groups.values()) {
    for (const [rowIndex, row] of group.entries()) {
      const identity = [
        ...wrap(
          `${row.participant.firstName} ${row.participant.paternalSurname} ${row.participant.maternalSurname}`,
          identityWidth - 2 * CELL_PADDING,
        ).map((value) => ({ value, size: FONT_SIZE, color: INK })),
        ...wrap(
          `CI: ${row.participant.ci} · ${PARTICIPANT_LABELS[row.price.participantType]}`,
          identityWidth - 2 * CELL_PADDING,
          SECONDARY_SIZE,
        ).map((value) => ({ value, size: SECONDARY_SIZE, color: MUTED })),
        ...wrap(
          `Responsable: ${row.registeredByName?.trim() || "No registrado"}`,
          identityWidth - 2 * CELL_PADDING,
          SECONDARY_SIZE,
        ).map((value) => ({ value, size: SECONDARY_SIZE, color: MUTED })),
      ];
      const state = wrap(
        `${MEMBERSHIP_LABELS[row.membershipStatus]}\n${FINANCE_LABELS[row.financialStatus]}`,
        statusWidth - 2 * CELL_PADDING,
      );
      const height = Math.max(identity.length, state.length) * LINE_HEIGHT + 10;
      const headingHeight = groupHeading(row).height + 34;
      const startsGroup = rowIndex === 0;
      // A group may follow another on the same page. Its heading and at least
      // one complete row must fit; continuation pages repeat both headings.
      if (y - height - (startsGroup ? headingHeight : 0) < FOOTER_TOP) {
        newPage();
        if (y - headingHeight - height < FOOTER_TOP)
          throw new RegistrationPdfTextError();
        tableHeading(row);
      } else if (startsGroup) tableHeading(row);
      if (y - height < FOOTER_TOP) throw new RegistrationPdfTextError();
      for (const [lineIndex, line] of identity.entries())
        text(
          line.value,
          MARGIN + CELL_PADDING,
          y - lineIndex * LINE_HEIGHT,
          line.size,
          line.color,
        );
      for (const [lineIndex, line] of state.entries())
        text(
          line,
          MARGIN + identityWidth + CELL_PADDING,
          y - lineIndex * LINE_HEIGHT,
          FONT_SIZE,
          lineIndex ? MUTED : INK,
        );
      let x = MARGIN + identityWidth + statusWidth;
      for (const [index, column] of amountColumns.entries()) {
        rightText(
          reportDecimal(column.value(row)),
          x + amountWidths[index]! - CELL_PADDING,
          y,
        );
        x += amountWidths[index]!;
      }
      y -= height;
      rule(y + 10, RULE, 0.3);
      if (rowIndex === group.length - 1) y -= 12;
    }
  }
  for (const [index, current] of document.getPages().entries()) {
    current.drawText("Estado vivo · Uso exclusivo ADMIN", {
      x: MARGIN,
      y: 23,
      size: 7.5,
      font,
      color: MUTED,
    });
    const pagination = `Página ${index + 1} de ${document.getPageCount()}`;
    current.drawText(pagination, {
      x: WIDTH - MARGIN - font.widthOfTextAtSize(pagination, 7.5),
      y: 23,
      size: 7.5,
      font,
      color: MUTED,
    });
  }
  return document.save();
}
