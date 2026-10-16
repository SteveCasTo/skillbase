import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import boldAsset from "@fontsource/montserrat/files/montserrat-latin-700-normal.woff?inline";
import fontAsset from "@/server/pre-registrations/exports/fonts/noto-sans-regular.json";
import { PdfTextError, wrapPdfText } from "@/server/exports/pdf-text";
import type {
  CourseReport,
  CourseReportCourse,
} from "@/application/courses/course-report";
import { courseAcademicPhaseLabels } from "@/domain/courses/academic-phase";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import {
  groupSchedule,
  levelLabels,
  reportDate,
  reportDecimal,
  statusLabels,
} from "./columns";

const W = 595.28,
  H = 841.89,
  M = 36,
  CONTENT = W - 2 * M,
  BOTTOM = 48;
const INK = rgb(0.23, 0.2, 0.21),
  MUTED = rgb(0.39, 0.37, 0.35),
  ACCENT = rgb(0.68, 0.27, 0.18),
  RULE = rgb(0.86, 0.83, 0.81),
  WASH = rgb(0.975, 0.965, 0.96);
const widths = [160, 85, 54, 87, 65, CONTENT - 451];
const labels = [
  "Grupo / horario",
  "Inicio / fin",
  "Inscritos",
  "Neto BOB",
  "Aprobados",
  "No aprobados",
];

/** Dedicated course composition. Renderers receive only authorized aggregate DTOs. */
export async function renderCoursesPdf(
  report: CourseReport,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const match = /^data:[^,]+;base64,([A-Za-z0-9+/=]+)$/.exec(boldAsset);
  const boldBytes = match
    ? Uint8Array.from(Buffer.from(match[1]!, "base64"))
    : process.versions.bun
      ? Uint8Array.from(await readFile(boldAsset))
      : (() => {
          throw new Error("Course font was not bundled.");
        })();
  const font = await doc.embedFont(
    Uint8Array.from(Buffer.from(fontAsset.base64, "base64")),
    { subset: true },
  );
  const bold = await doc.embedFont(boldBytes, { subset: true });
  const sets = new Map(
    [font, bold].map((face) => [face, new Set(face.getCharacterSet())]),
  );
  const faceFor = (value: string, preferred = font) =>
    [...value].every(
      (c) => c === "\n" || sets.get(preferred)!.has(c.codePointAt(0)!),
    )
      ? preferred
      : font;
  const wrap = (value: string, width: number, size = 9, preferred = font) =>
    wrapPdfText(
      value,
      faceFor(value, preferred),
      width,
      sets.get(faceFor(value, preferred)),
      size,
    );
  let page: PDFPage;
  let y = 0;
  function text(
    value: string,
    x: number,
    top: number,
    size = 9,
    color = INK,
    preferred: PDFFont = font,
  ) {
    const face = faceFor(value, preferred);
    wrapPdfText(value, face, CONTENT, sets.get(face), size);
    page.drawText(value, { x, y: top - size, font: face, size, color });
  }
  function rule(top: number, color = RULE) {
    page.drawLine({
      start: { x: M, y: top },
      end: { x: W - M, y: top },
      thickness: 0.6,
      color,
    });
  }
  function lines(
    value: string[],
    x: number,
    top: number,
    size = 9,
    color = INK,
    preferred = font,
  ) {
    value.forEach((line, index) =>
      text(line, x, top - index * (size + 4), size, color, preferred),
    );
  }
  function newPage() {
    page = doc.addPage([W, H]);
    text("Universidad Mayor de San Simón", M, H - 30, 9, INK, bold);
    text("Departamento de Informática y Sistemas · FCyT", M, H - 45, 8, MUTED);
    rule(H - 63, ACCENT);
    y = H - 80;
  }
  function tableHeader() {
    page.drawRectangle({
      x: M,
      y: y - 29,
      width: CONTENT,
      height: 29,
      color: WASH,
    });
    let x = M;
    labels.forEach((label, index) => {
      const value = wrap(label, widths[index]! - 12, 8, bold);
      lines(value, x + 6, y - 6, 8, MUTED, bold);
      x += widths[index]!;
    });
    y -= 29;
  }
  function courseHeader(course: CourseReportCourse, continuation: boolean) {
    const title = wrap(course.name, CONTENT, 15, bold);
    const instructor = wrap(`Instructor: ${course.instructorName}`, CONTENT, 9);
    const height =
      title.length * 19 + (continuation ? 54 : instructor.length * 13 + 120);
    const reserve = course.groups.length ? 55 : 22;
    // Measure the actual header and keep at least a useful row fragment with it.
    // A title too large even on a fresh page fails rather than entering the footer.
    if (H - 80 - height - reserve < BOTTOM) throw new PdfTextError();
    if (y - height - reserve < BOTTOM) newPage();
    lines(title, M, y, 15, INK, bold);
    y -= title.length * 19 + 5;
    if (continuation) {
      text("Continuación", M, y, 8, MUTED);
      y -= 20;
      tableHeader();
      return;
    }
    text(
      `${levelLabels[course.level]} · ${statusLabels[course.status]} · ${courseAcademicPhaseLabels[course.phase]}`,
      M,
      y,
      9,
      ACCENT,
    );
    y -= 18;
    lines(instructor, M, y);
    y -= instructor.length * 13 + 5;
    text(
      `${reportDate(course.startsAt)} — ${reportDate(course.endsAt)}`,
      M,
      y,
      9,
      MUTED,
    );
    y -= 18;
    text(
      `Precios BOB   Estudiante ${reportDecimal(course.studentCents)}    Externo ${reportDecimal(course.externalCents)}    Auxiliar ${reportDecimal(course.auxiliaryCents)}`,
      M,
      y,
      8.5,
      MUTED,
    );
    y -= 22;
    text(
      `${course.groups.length} ${course.groups.length === 1 ? "grupo" : "grupos"}`,
      M,
      y,
      10,
      INK,
      bold,
    );
    text(
      `${course.enrolled} ${course.enrolled === 1 ? "inscrito" : "inscritos"}`,
      M + 130,
      y,
      10,
      INK,
      bold,
    );
    const amount = `${reportDecimal(course.netCents)} BOB netos`;
    text(
      amount,
      W - M - faceFor(amount, bold).widthOfTextAtSize(amount, 10),
      y,
      10,
      ACCENT,
      bold,
    );
    y -= 23;
    if (course.groups.length) tableHeader();
  }
  newPage();
  doc.setTitle("Informe de cursos");
  doc.setAuthor("Departamento de Informática y Sistemas");
  doc.setLanguage("es-BO");
  doc.setCreationDate(report.generatedAt);
  doc.setModificationDate(report.generatedAt);
  text("Informe de cursos", M, y, 23, INK, bold);
  y -= 37;
  const civil = instantToBoliviaCivil(report.generatedAt);
  text(
    `${reportDate(report.generatedAt)} · ${civil.slice(11)}`,
    M,
    y,
    9,
    MUTED,
  );
  const status = {
    ALL: "Todos",
    PUBLISHED: "Publicados",
    DRAFT: "Borradores",
    ARCHIVED: "Archivados",
  }[report.filter.status];
  const filters = wrap(
    `${status}${report.filter.search ? ` · ${report.filter.search}` : ""}`,
    CONTENT,
    9,
  );
  y -= 18;
  lines(filters, M, y, 9, MUTED);
  y -= filters.length * 13 + 12;
  text(
    `${report.courses.length} ${report.courses.length === 1 ? "curso" : "cursos"}   /   ${report.groupCount} ${report.groupCount === 1 ? "grupo" : "grupos"}   /   ${report.uniqueEnrolled} ${report.uniqueEnrolled === 1 ? "estudiante único" : "estudiantes únicos"}`,
    M,
    y,
    9,
    INK,
    bold,
  );
  y -= 18;
  text(
    `Recaudación neta   ${reportDecimal(report.netCents)} BOB`,
    M,
    y,
    10,
    ACCENT,
    bold,
  );
  y -= 32;
  for (const course of report.courses) {
    courseHeader(course, false);
    if (!course.groups.length) {
      text("Sin grupos", M, y, 9, MUTED);
      y -= 22;
    }
    for (const group of course.groups) {
      const cells = [
        [
          `Grupo ${group.number}`,
          ...wrap(groupSchedule(group), widths[0]! - 12),
        ],
        [reportDate(group.startsAt), reportDate(group.endsAt)],
        [String(group.enrolled)],
        [reportDecimal(group.netCents)],
        [group.passed === null ? "—" : String(group.passed)],
        [group.notPassed === null ? "—" : String(group.notPassed)],
      ];
      const totalLines = Math.max(...cells.map((cell) => cell.length));
      const height = totalLines * 13 + 16;
      const freshCapacity =
        H -
        80 -
        (wrap(course.name, CONTENT, 15, bold).length * 19 + 54) -
        BOTTOM;
      // Ordinary rows stay indivisible. Oversized schedules instead continue in
      // bounded fragments, with each page's real post-header space remeasured.
      if (
        y - height < BOTTOM &&
        height <= freshCapacity &&
        group !== course.groups[0]
      ) {
        newPage();
        courseHeader(course, true);
      }
      let offset = 0;
      while (offset < totalLines) {
        const repeatedLabel =
          offset > 0 ? [`Grupo ${group.number} (continuación)`] : [];
        let capacity =
          Math.floor((y - BOTTOM - 16) / 13) - repeatedLabel.length;
        if (capacity < 2) {
          newPage();
          courseHeader(course, true);
          capacity = Math.floor((y - BOTTOM - 16) / 13) - repeatedLabel.length;
        }
        if (capacity < 2) throw new PdfTextError();
        const count = Math.min(capacity, totalLines - offset);
        const fragment = cells.map((cell, index) => [
          ...(index === 0 ? repeatedLabel : []),
          ...cell.slice(offset, offset + count),
        ]);
        const fragmentHeight = (count + repeatedLabel.length) * 13 + 16;
        if (y - fragmentHeight < BOTTOM) throw new PdfTextError();
        let x = M;
        fragment.forEach((cell, index) => {
          cell.forEach((value, line) => {
            const preferred =
              index === 0 &&
              line === 0 &&
              (offset === 0 || repeatedLabel.length > 0)
                ? bold
                : font;
            const width = faceFor(value, preferred).widthOfTextAtSize(value, 9);
            if (width > widths[index]! - 12) throw new PdfTextError();
            text(
              value,
              index < 2 ? x + 6 : x + widths[index]! - 6 - width,
              y - 8 - line * 13,
              9,
              index === 3 ? ACCENT : INK,
              preferred,
            );
          });
          x += widths[index]!;
        });
        y -= fragmentHeight;
        rule(y);
        offset += count;
        if (offset < totalLines) {
          newPage();
          courseHeader(course, true);
        }
      }
    }
    y -= 26;
  }
  const pages = doc.getPages();
  pages.forEach((current, index) => {
    page = current;
    rule(35);
    text("Informe de cursos", M, 25, 8, MUTED);
    const pagination = `${index + 1} / ${pages.length}`;
    text(
      pagination,
      W - M - font.widthOfTextAtSize(pagination, 8),
      25,
      8,
      MUTED,
    );
  });
  return doc.save();
}
