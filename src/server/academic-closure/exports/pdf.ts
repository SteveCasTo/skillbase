import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import type { ClosureVersionDto } from "@/domain/academic-closure/types";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import { participantFullName } from "@/domain/pre-registrations/participant-name";
import { centsToDecimal } from "@/domain/pre-registrations/money";
import fontAsset from "@/server/pre-registrations/exports/fonts/noto-sans-regular.json";
import {
  RegistrationPdfTextError,
  wrapPdfText,
} from "@/server/pre-registrations/exports/pdf";
import { closureSummary, gradeText, validateOfficialVersion } from "./document";
import { closurePdfResources } from "./resources";

/** Both historical PDF names are compatible aliases of the same document. */
export type ClosurePdfKind = "planilla" | "informe";
const WIDTH = 841.89;
const HEIGHT = 595.28;
const MARGIN = 36;
const CONTENT = WIDTH - 2 * MARGIN;
const BOTTOM = 60;
// Print equivalents of the operational foreground, primary and muted tokens.
const INK = rgb(0.23, 0.2, 0.21);
const MUTED = rgb(0.39, 0.37, 0.35);
const ACCENT = rgb(0.76, 0.31, 0.22);
const RULE = rgb(0.86, 0.83, 0.81);
const SURFACE = rgb(0.975, 0.965, 0.96);

/** Only authorized, immutable snapshot DTOs enter this request-local renderer. */
export async function renderClosurePdf(
  version: ClosureVersionDto,
  // Retained for existing server callers; never selects a separate artifact.
  kind: ClosurePdfKind = "informe",
): Promise<Uint8Array> {
  validateOfficialVersion(version);
  const r = version.report;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const resources = await closurePdfResources();
  const [regular, bold, fallback] = await Promise.all([
    doc.embedFont(resources.regular, { subset: true }),
    doc.embedFont(resources.bold, { subset: true }),
    doc.embedFont(Uint8Array.from(Buffer.from(fontAsset.base64, "base64")), {
      subset: true,
    }),
  ]);
  const logos = await Promise.all(
    resources.logos.map((asset) => doc.embedPng(asset)),
  );
  const sets = new Map(
    [regular, bold, fallback].map((font) => [
      font,
      new Set(font.getCharacterSet()),
    ]),
  );
  const wrapping = new Map<string, string[]>();
  function face(value: string, strong = false): PDFFont {
    const chosen = strong ? bold : regular;
    return [...value].every(
      (c) => c === "\n" || sets.get(chosen)!.has(c.codePointAt(0)!),
    )
      ? chosen
      : fallback;
  }
  function wrap(
    value: string,
    width: number,
    size = 9,
    strong = false,
  ): string[] {
    const key = JSON.stringify([value, width, size, strong]);
    const cached = wrapping.get(key);
    if (cached) return cached;
    const font = face(value, strong);
    // Validate once, without shaping the full string a second time. Oversized
    // words use the shared grapheme-safe wrapper at its scaled 8pt measure.
    const supported = sets.get(font)!;
    for (const c of value)
      if (c !== "\n" && !supported.has(c.codePointAt(0)!))
        throw new RegistrationPdfTextError();
    const lines: string[] = [];
    // Prefer word boundaries, retaining the grapheme fallback for unbroken names.
    for (const paragraph of value.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
        else {
          if (line) lines.push(line);
          const parts = wrapPdfText(
            word,
            font,
            (width * 8) / size,
            sets.get(font)!,
          );
          lines.push(...parts.slice(0, -1));
          line = parts.at(-1) ?? "";
        }
      }
      lines.push(line);
    }
    wrapping.set(key, lines);
    return lines;
  }
  doc.setTitle("Informe de cierre académico");
  doc.setAuthor(version.actorName);
  doc.setCreator("SkillBase");
  doc.setProducer("SkillBase");
  doc.setLanguage("es-BO");
  doc.setCreationDate(new Date(version.closedAt));
  doc.setModificationDate(new Date(version.closedAt));
  // Kind intentionally has no effect on contents or metadata (legacy alias).
  void kind;
  const civil = instantToBoliviaCivil(new Date(version.closedAt)).replace(
    "T",
    " ",
  );
  // newPage initializes this before any drawing; callbacks share the active page.
  let page!: PDFPage;
  let y = 0;
  function draw(
    value: string,
    x: number,
    top: number,
    size = 9,
    strong = false,
    color = INK,
    font = face(value, strong),
  ) {
    page.drawText(value, {
      x,
      y: top - size,
      size,
      font,
      color,
    });
  }
  function rule(top: number) {
    page.drawLine({
      start: { x: MARGIN, y: top },
      end: { x: WIDTH - MARGIN, y: top },
      color: RULE,
      thickness: 0.6,
    });
  }
  function newPage(section: string) {
    page = doc.addPage([WIDTH, HEIGHT]);
    draw("Universidad Mayor de San Simón", MARGIN, HEIGHT - 28, 10, true);
    draw(
      "Facultad de Ciencias y Tecnología",
      MARGIN,
      HEIGHT - 44,
      8,
      false,
      MUTED,
    );
    draw(
      "Departamento de Informática y Sistemas",
      MARGIN,
      HEIGHT - 57,
      8,
      false,
      MUTED,
    );
    let logoX = WIDTH - MARGIN - 272;
    for (const logo of logos) {
      const scale = Math.min(80 / logo.width, 42 / logo.height);
      page.drawImage(logo, {
        x: logoX + (80 - logo.width * scale) / 2,
        y: HEIGHT - 72 + (42 - logo.height * scale) / 2,
        width: logo.width * scale,
        height: logo.height * scale,
      });
      logoX += 96;
    }
    rule(HEIGHT - 82);
    y = HEIGHT - 98;
    draw(section, MARGIN, y, 19, true);
    y -= 32;
  }
  function paragraph(value: string, size = 9, strong = false, color = INK) {
    for (const line of wrap(value, CONTENT, size, strong)) {
      if (y - size - 4 < BOTTOM) newPage("Informe de cierre · continuación");
      draw(line, MARGIN, y, size, strong, color, face(value, strong));
      y -= size + 5;
    }
    y -= 6;
  }
  function section(title: string) {
    if (y < BOTTOM + 80) newPage("Informe de cierre · continuación");
    y -= 8;
    rule(y);
    y -= 12;
    paragraph(title, 11, true);
  }
  newPage("Informe de cierre académico");
  paragraph(r.courseName, 16, true);
  paragraph(
    `Grupo: ${r.groupName} · Cierre: ${civil} (Bolivia UTC-04)`,
    9,
    false,
    MUTED,
  );
  paragraph(`Instructor al cierre: ${r.instructorName ?? "Sin instructor"}`);
  section("Resumen de resultados y asistencia");
  const indicators = [
    ["Participantes", r.participants.length],
    ["Nota aprobada", r.participants.filter((p) => p.result.passed).length],
    [
      "Aprobación académica final",
      r.participants.filter((p) => p.academicallyPassed).length,
    ],
  ] as const;
  indicators.forEach(([label, count], index) => {
    const x = MARGIN + (index * CONTENT) / 3;
    draw(String(count), x, y, 21, true, ACCENT);
    draw(label, x, y - 29, 9, true);
  });
  y -= 60;
  for (const line of closureSummary(r).slice(1)) paragraph(line);
  section("Criterios y trazabilidad del cierre");
  paragraph(
    `Nota mínima histórica: ${gradeText(String(r.minimumGrade))} / 100 · Límite de ausencias consecutivas: ${r.attendanceSettings.consecutiveAbsenceLimit}`,
  );
  paragraph(
    `La aprobación académica combina nota aprobada y elegibilidad por asistencia.${r.access === "ADMIN" ? " Los saldos son informativos y no condicionan el resultado académico." : ""}`,
  );
  paragraph(`Responsable al cierre: ${version.actorName}`);
  paragraph(
    `Versión: ${version.version} · Registro: ${version.id} · Actor: ${version.actorId}`,
    7,
    false,
    MUTED,
  );
  paragraph(
    "Fuente: snapshot histórico inmutable del grupo. Las reaperturas y los cambios posteriores no modifican esta evidencia.",
    8,
    false,
    MUTED,
  );

  const widths = [190, 240, 150, CONTENT - 580];
  const headings = [
    r.access === "ADMIN" ? "Participante / CI" : "Participante",
    "Evaluación · peso · nota",
    "Resultado académico",
    "Asistencia",
  ];
  const tableTop = () => {
    newPage("Planilla de participantes y calificaciones");
    paragraph(`${r.courseName} · ${r.groupName}`, 9, true);
    paragraph(
      `Cierre: ${civil} · Versión ${version.version} · ${r.participants.length} ${r.participants.length === 1 ? "participante" : "participantes"}`,
      8,
      false,
      MUTED,
    );
    page.drawRectangle({
      x: MARGIN,
      y: y - 28,
      width: CONTENT,
      height: 28,
      color: SURFACE,
    });
    let x = MARGIN;
    headings.forEach((heading, i) => {
      draw(heading, x + 8, y - 8, 8, true);
      x += widths[i]!;
    });
    y -= 28;
    return y;
  };
  let tableStart = tableTop();
  if (!r.participants.length) {
    y -= 16;
    paragraph("Sin participantes INSCRITO en esta versión.");
  }
  for (const [index, p] of r.participants.entries()) {
    const admin = r.access === "ADMIN" ? r.participants[index] : null;
    const values = [
      `${index + 1}. ${participantFullName(p)}${admin ? `\nCI: ${admin.ci}` : ""}`,
      [...r.scheme.components]
        .sort((a, b) => a.order - b.order)
        .map(
          (c) =>
            `${c.name} · ${gradeText(c.weight)} % · ${gradeText(p.grades.find((g) => g.componentId === c.id)?.score ?? null)}`,
        )
        .join("\n"),
      `Final: ${gradeText(p.result.finalGrade)} / 100\nNota: ${p.result.passed ? "aprobada" : "no aprobada"}\nAcadémico: ${p.academicallyPassed ? "aprobado" : "no aprobado"}${admin?.balanceCents == null ? "" : `\nSaldo informativo:\nBs ${centsToDecimal(admin.balanceCents)}`}`,
      `Presentes: ${p.attendance.present}\nAusentes: ${p.attendance.absent}\nJustificadas: ${p.attendance.excused}\nRacha máxima: ${p.attendance.maximumConsecutiveAbsences}\nElegible: ${p.attendance.academicallyEligible ? "sí" : "no"}`,
    ];
    const cells = values.map((value, i) =>
      wrap(value, widths[i]! - 16, 8, i === 0),
    );
    const count = Math.max(...cells.map((cell) => cell.length));
    const fullHeight = count * 12 + 20;
    // Keep ordinary rows together; split only rows taller than a full page.
    if (y - fullHeight < BOTTOM && y !== tableStart) tableStart = tableTop();
    for (let offset = 0; offset < count;) {
      if (y - 32 < BOTTOM) tableStart = tableTop();
      if (offset) {
        draw(
          `Participante ${index + 1} · continuación`,
          MARGIN + 8,
          y - 7,
          8,
          true,
          ACCENT,
        );
        y -= 24;
      }
      const available = Math.min(
        count - offset,
        Math.floor((y - BOTTOM - 20) / 12),
      );
      if (available < 1) {
        tableStart = tableTop();
        continue;
      }
      const height = available * 12 + 20;
      if (index % 2 === 1)
        page.drawRectangle({
          x: MARGIN,
          y: y - height,
          width: CONTENT,
          height,
          color: SURFACE,
        });
      let x = MARGIN;
      cells.forEach((lines, i) => {
        lines
          .slice(offset, offset + available)
          .forEach((line, j) =>
            draw(
              line,
              x + 8,
              y - 10 - j * 12,
              8,
              i === 0 && offset + j === 0,
              INK,
              face(values[i]!, i === 0 && offset + j === 0),
            ),
          );
        x += widths[i]!;
      });
      y -= height;
      rule(y);
      offset += available;
      if (offset < count) tableStart = tableTop();
    }
  }
  doc.getPages().forEach((current, index) => {
    page = current;
    rule(44);
    draw(
      `Privado · ${r.access} · No es certificado ni recibo`,
      MARGIN,
      32,
      8,
      false,
      MUTED,
    );
    const label = `Página ${index + 1} de ${doc.getPageCount()}`;
    draw(
      label,
      WIDTH - MARGIN - face(label).widthOfTextAtSize(label, 8),
      32,
      8,
      false,
      MUTED,
    );
  });
  return doc.save();
}
