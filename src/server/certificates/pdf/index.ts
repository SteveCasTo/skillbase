import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { certificateResources } from "./resources";
import { certificateDocument } from "./document";
import { drawCertificateText } from "./text";
import { CERTIFICATE_QR_SIZE, drawCertificateQr } from "./qr";
import type { CertificateRenderInput } from "./types";

export { CERTIFICATE_PDF_TEMPLATE_VERSION, CertificatePdfError } from "./types";
export type { CertificateRenderInput, CertificateSignatory } from "./types";

const NAVY = rgb(0.055, 0.105, 0.21);
const RED = rgb(0.8, 0.14, 0.035);
export const CERTIFICATE_PAGE_SIZES = {
  APPROVAL: [792, 612],
  INSTRUCTOR: [612, 792],
} as const;

function decoration(page: PDFPage, approval: boolean) {
  const top = page.getHeight();
  if (approval) {
    page.drawSvgPath(
      "M0 0 L63 0 C68 132 27 243 33 352 C41 446 70 532 103 612 L0 612 Z",
      { x: 0, y: top, color: RED },
    );
    page.drawSvgPath(
      "M0 0 L60 0 C65 132 24 243 30 352 C38 446 67 532 94 612 L0 612 Z",
      { x: 0, y: top, color: NAVY },
    );
    for (let i = 0; i < 9; i++) {
      page.drawSvgPath(
        `M${115 + i * 8} 612 C${205 + i * 12} ${408 + i * 6} ${260 + i * 12} ${617 - i * 10} 792 ${365 + i * 6}`,
        {
          x: 0,
          y: top,
          borderColor: rgb(0.94, 0.94, 0.94),
          borderWidth: 0.8,
        },
      );
    }
    page.drawSvgPath("M792 560 L792 612 L740 612 Z", {
      x: 0,
      y: top,
      color: NAVY,
    });
    page.drawLine({
      start: { x: 752, y: 4 },
      end: { x: 775, y: 27 },
      thickness: 11,
      color: RED,
    });
    page.drawLine({
      start: { x: 780, y: 25 },
      end: { x: 792, y: 37 },
      thickness: 11,
      color: RED,
    });
  } else {
    page.drawSvgPath(
      "M0 0 L612 0 L612 67 C565 8 530 4 474 12 C310 28 250 96 0 27 Z",
      { x: 0, y: top, color: NAVY },
    );
    page.drawSvgPath(
      "M0 792 L0 720 C100 820 260 775 370 744 C452 730 518 743 612 768 L612 792 Z",
      { x: 0, y: top, color: NAVY },
    );
  }
}

function signatures(
  page: PDFPage,
  input: CertificateRenderInput,
  regular: PDFFont,
  bold: PDFFont,
) {
  const approval = input.type === "APPROVAL";
  const left = approval ? 116 : 42;
  const width = approval ? 620 : 528;
  const cell = width / 3;
  const lineY = approval ? 80 : 120;
  for (const [index, signer] of input.signatories.entries()) {
    const x = left + index * cell + 10;
    const innerWidth = cell - 20;
    page.drawLine({
      start: { x: x + 12, y: lineY },
      end: { x: x + innerWidth - 12, y: lineY },
      thickness: 0.7,
      color: rgb(0, 0, 0),
    });
    let top = page.getHeight() - lineY + 4;
    for (const [value, font, minimumSize] of [
      [signer.name, regular, 6.75],
      [signer.role, bold, 6.75],
      [signer.affiliation, regular, 6.75],
    ] as const) {
      if (!value) {
        top += 11;
        continue;
      }
      const fitted = drawCertificateText(page, value, font, {
        x,
        top,
        width: innerWidth,
        height: 20.5,
        size: 8,
        minimumSize,
        align: "center",
      });
      top += fitted.lines.length * fitted.lineHeight + 1;
    }
  }
}

/** One unsigned certificate from frozen presentation data. No eligibility,
 * live lookups, signatures, issuance or hash of the final scanned PDF here. */
export async function renderCertificatePdf(
  input: CertificateRenderInput,
  options: { preview?: boolean } = {},
): Promise<Uint8Array> {
  const content = certificateDocument(input, options.preview);
  const resources = await certificateResources();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, bold, display] = await Promise.all([
    doc.embedFont(resources.regular, {
      subset: true,
      customName: "Montserrat-Regular",
    }),
    doc.embedFont(resources.bold, {
      subset: true,
      customName: "Montserrat-Bold",
    }),
    doc.embedFont(resources.display, {
      subset: true,
      customName: "Merriweather-Bold",
    }),
  ]);
  doc.setTitle(content.title);
  doc.setAuthor("Departamento de Informática y Sistemas");
  doc.setCreator(`Certificados / plantilla ${input.templateVersion}`);
  doc.setProducer("pdf-lib");
  doc.setLanguage("es-BO");
  doc.setCreationDate(new Date(input.generatedAt));
  doc.setModificationDate(new Date(input.generatedAt));
  const page = doc.addPage([...CERTIFICATE_PAGE_SIZES[input.type]]);
  const approval = input.type === "APPROVAL";
  decoration(page, approval);
  const x = approval ? 116 : 76;
  const width = approval ? 620 : 460;
  for (const [index, bytes] of resources.logos.entries()) {
    const logo = await doc.embedPng(bytes);
    const imageWidth = 190;
    const imageHeight = (imageWidth * logo.height) / logo.width;
    const imageX = approval ? 95 + index * 211 : 16 + index * 195;
    page.drawImage(logo, {
      x: imageX,
      y: page.getHeight() - (approval ? 29 : 68) - imageHeight,
      width: imageWidth,
      height: imageHeight,
    });
  }
  const center = (
    text: string,
    font: PDFFont,
    top: number,
    height: number,
    size: number,
    minimumSize = size,
  ) =>
    drawCertificateText(page, text, font, {
      x,
      top,
      width,
      height,
      size,
      minimumSize,
      align: "center",
    });
  // The header's right column belongs to verification, not to the recipient or
  // signature area. Keep the institutional logos and body widths unchanged.
  const heading = (text: string, top: number, height: number, size: number) =>
    drawCertificateText(page, text, display, {
      x,
      top,
      width: approval ? width : 376,
      height,
      size,
      minimumSize: size,
      align: "center",
    });
  if (approval) {
    heading("CERTIFICADO", 111, 47, 32);
    const badgeWidth = 125;
    const badgeX = x + (width - badgeWidth) / 2;
    page.drawLine({
      start: { x: badgeX - 65, y: 445 },
      end: { x: badgeX + badgeWidth + 65, y: 445 },
      thickness: 1.2,
      color: rgb(0, 0, 0),
    });
    page.drawRectangle({
      x: badgeX,
      y: 435,
      width: badgeWidth,
      height: 20,
      color: NAVY,
    });
    drawCertificateText(page, "DE APROBACIÓN", regular, {
      x: badgeX,
      top: 158,
      width: badgeWidth,
      height: 20,
      size: 10,
      minimumSize: 10,
      align: "center",
      color: rgb(1, 1, 1),
    });
  } else {
    heading("CERTIFICADO", 161, 43, 28);
    heading("DE", 201, 30, 18);
    const headingOffset = -42;
    page.drawLine({
      start: { x: 180 + headingOffset, y: 578 },
      end: { x: 278 + headingOffset, y: 578 },
      thickness: 0.8,
      color: rgb(0, 0, 0),
    });
    page.drawLine({
      start: { x: 334 + headingOffset, y: 578 },
      end: { x: 432 + headingOffset, y: 578 },
      thickness: 0.8,
      color: rgb(0, 0, 0),
    });
    heading("INSTRUCTOR", 227, 44, 28);
  }
  const approvalOffset = 44;
  const recipientTop = approval ? 206 + approvalOffset : 295;
  const labelWidth = approval ? 116 : 28;
  drawCertificateText(page, approval ? "OTORGADO A:" : "A:", regular, {
    x,
    top: recipientTop + 3,
    width: labelWidth,
    height: 24,
    size: approval ? 11 : 10,
    minimumSize: 10,
  });
  drawCertificateText(page, input.recipientName, regular, {
    x: x + labelWidth + 8,
    top: recipientTop,
    width: width - labelWidth - 8,
    height: 43,
    size: approval ? 18 : 15,
    minimumSize: 11,
    align: "center",
  });
  page.drawLine({
    start: { x: x + labelWidth + 8, y: page.getHeight() - recipientTop - 44 },
    end: { x: x + width, y: page.getHeight() - recipientTop - 44 },
    thickness: 0.6,
    color: rgb(0, 0, 0),
  });
  center(
    content.introduction,
    regular,
    approval ? 264 + approvalOffset : 351,
    31,
    approval ? 11.2 : 10.5,
    10,
  );
  // No course pictogram was supplied as a separate approved asset. Keep the
  // title prominent; do not extract private screenshots or invent an emblem.
  center(
    content.course,
    bold,
    approval ? 291 + approvalOffset : 381,
    approval ? 54 : 77,
    approval ? 26 : 25,
    15,
  );
  drawCertificateText(page, content.body, regular, {
    x,
    top: approval ? 349 + approvalOffset : 476,
    width,
    height: approval ? 53 : 83,
    size: approval ? 11 : 10.5,
    minimumSize: 9.5,
  });
  center(
    content.date,
    regular,
    approval ? 406 + approvalOffset : 558,
    24,
    11,
    10,
  );
  signatures(page, input, regular, bold);
  const verification = approval
    ? { x: 538, top: 105, width: 220, codeHeight: 60 }
    : { x: 414, top: 140, width: 180, codeHeight: 70 };
  drawCertificateQr(
    doc,
    page,
    input.verificationUrl,
    verification.x + (verification.width - CERTIFICATE_QR_SIZE) / 2,
    page.getHeight() - verification.top - CERTIFICATE_QR_SIZE,
  );
  drawCertificateText(page, `ID: ${input.publicCredentialId}`, regular, {
    x: verification.x,
    top: verification.top + CERTIFICATE_QR_SIZE + 6,
    width: verification.width,
    height: verification.codeHeight,
    size: 8,
    minimumSize: 7,
    align: "center",
  });
  return doc.save({ useObjectStreams: false });
}
