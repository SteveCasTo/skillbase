import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFPage, rgb } from "pdf-lib";
import type { ClosureVersionDto } from "@/domain/academic-closure/types";
import fontAsset from "@/server/pre-registrations/exports/fonts/noto-sans-regular.json";
import { wrapPdfText } from "@/server/pre-registrations/exports/pdf";
import { centsToDecimal } from "@/domain/pre-registrations/money";
import {
  closureMetadata,
  closureSummary,
  gradeText,
  validateOfficialVersion,
} from "./document";

export type ClosurePdfKind = "planilla" | "informe";
/** Local embedded OFL font; request-local document, no HTTP assets, browser or storage. */
export async function renderClosurePdf(
  version: ClosureVersionDto,
  kind: ClosurePdfKind,
): Promise<Uint8Array> {
  validateOfficialVersion(version);
  const r = version.report;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    Uint8Array.from(Buffer.from(fontAsset.base64, "base64")),
    { subset: true },
  );
  const supported = new Set(font.getCharacterSet());
  const title =
    kind === "planilla"
      ? "Planilla oficial de cierre"
      : "Informe oficial de cierre";
  doc.setTitle(title);
  doc.setAuthor(version.actorName);
  doc.setCreator("SkillBase");
  doc.setProducer("SkillBase");
  doc.setLanguage("es-BO");
  doc.setCreationDate(new Date(version.closedAt));
  doc.setModificationDate(new Date(version.closedAt));
  const width = 841.89,
    height = 595.28,
    margin = 36,
    lineHeight = 12;
  let page: PDFPage,
    y = 0;
  const ink = rgb(0.12, 0.15, 0.2);
  function draw(text: string, x: number, top: number, size = 8) {
    page.drawText(text, { x, y: top, font, size, color: ink });
  }
  function newPage() {
    page = doc.addPage([width, height]);
    draw(`SkillBase / ${title}`, margin, height - 40, 16);
    draw(
      `Documento privado · Versión ${version.version} · ${version.id}`,
      margin,
      height - 58,
    );
    y = height - 82;
  }
  function paragraph(value: string) {
    for (const line of wrapPdfText(
      value,
      font,
      width - 2 * margin,
      supported,
    )) {
      if (y < 55) newPage();
      draw(line, margin, y);
      y -= lineHeight;
    }
    y -= 6;
  }
  newPage();
  for (const line of closureMetadata(version)) paragraph(line);
  if (kind === "informe") for (const line of closureSummary(r)) paragraph(line);
  const widths = [200, 250, 140, 179.89];
  const headings = [
    r.access === "ADMIN" ? "Participante / CI" : "Participante",
    "Componentes / peso / nota",
    "Resultado",
    "Asistencia / elegibilidad",
  ];
  function tableHeading() {
    if (y < 85) newPage();
    let x = margin;
    headings.forEach((h, i) => {
      draw(h, x + 4, y);
      x += widths[i]!;
    });
    y -= 20;
  }
  tableHeading();
  if (!r.participants.length)
    paragraph("Sin participantes INSCRITO en esta versión.");
  for (const p of r.participants) {
    const ci =
      r.access === "ADMIN"
        ? `\nCI: ${r.participants.find((person) => person.registrationId === p.registrationId)!.ci}`
        : "";
    const balance =
      kind === "informe" && r.access === "ADMIN"
        ? r.participants.find(
            (person) => person.registrationId === p.registrationId,
          )!.balanceCents
        : null;
    const values = [
      `${p.firstName}\n${p.lastName}${ci}`,
      [...r.scheme.components]
        .sort((a, b) => a.order - b.order)
        .map(
          (c) =>
            `${c.name} / ${gradeText(c.weight)} % / ${gradeText(p.grades.find((g) => g.componentId === c.id)?.score ?? null)}`,
        )
        .join("\n"),
      `Nota final: ${gradeText(p.result.finalGrade)}\nNota: ${p.result.passed ? "aprobada" : "no aprobada"}\nAcadémico: ${p.academicallyPassed ? "aprobado" : "no aprobado"}${balance === null ? "" : `\nSaldo informativo: Bs ${centsToDecimal(balance)}`}`,
      `Presentes: ${p.attendance.present}\nAusentes: ${p.attendance.absent}\nJustificadas: ${p.attendance.excused}\nRacha máxima: ${p.attendance.maximumConsecutiveAbsences}\nElegible: ${p.attendance.academicallyEligible ? "sí" : "no"}`,
    ];
    const cells = values.map((v, i) =>
      wrapPdfText(v, font, widths[i]! - 8, supported),
    );
    const count = Math.max(...cells.map((c) => c.length));
    for (let offset = 0; offset < count;) {
      if (y < 65) {
        newPage();
        tableHeading();
      }
      const available = Math.min(
        count - offset,
        Math.floor((y - 48) / lineHeight),
      );
      let x = margin;
      cells.forEach((lines, i) => {
        lines
          .slice(offset, offset + available)
          .forEach((line, j) => draw(line, x + 4, y - j * lineHeight));
        x += widths[i]!;
      });
      y -= available * lineHeight;
      offset += available;
      if (offset < count) {
        newPage();
        tableHeading();
        paragraph(`Continuación: ${p.firstName} ${p.lastName}`);
      }
    }
    y -= 12;
  }
  doc
    .getPages()
    .forEach((current, i) =>
      current.drawText(
        `Privado ${r.access} · Página ${i + 1} de ${doc.getPageCount()} · No es certificado ni recibo`,
        { x: margin, y: 24, font, size: 8, color: ink },
      ),
    );
  return doc.save();
}
