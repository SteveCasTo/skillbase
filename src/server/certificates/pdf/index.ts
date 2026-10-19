import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { certificateResources } from "./resources";
import { certificateDocument } from "./document";
import { drawCertificateText, fitCertificateText } from "./text";
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
    // The continuous left curve is the frame. Keep the signature area and the
    // lower-right paper edge clear: no wave grid, corner wedge or red slashes.
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

/** Separate rules stop before the rounded band; nothing crosses its lettering. */
function certificateBand(
  page: PDFPage,
  text: string,
  font: PDFFont,
  center: number,
  top: number,
  span: number,
) {
  const width = 144;
  const height = 22;
  const radius = height / 2;
  const x = center - width / 2;
  const y = page.getHeight() - top - height / 2;
  for (const side of [-1, 1]) {
    const outer = center + (side * span) / 2;
    const inner = center + side * (width / 2 + 12);
    page.drawLine({
      start: { x: Math.min(outer, inner), y },
      end: { x: Math.max(outer, inner), y },
      thickness: 0.65,
      color: NAVY,
    });
    page.drawSvgPath("M0 -2.4 L2.4 0 L0 2.4 L-2.4 0 Z", {
      x: outer,
      y,
      color: RED,
    });
  }
  page.drawSvgPath(
    `M${radius} 0 H${width - radius} C${width - radius / 2} 0 ${width} ${radius / 2} ${width} ${radius} C${width} ${height - radius / 2} ${width - radius / 2} ${height} ${width - radius} ${height} H${radius} C${radius / 2} ${height} 0 ${height - radius / 2} 0 ${radius} C0 ${radius / 2} ${radius / 2} 0 ${radius} 0 Z`,
    { x, y: page.getHeight() - top, color: NAVY },
  );
  drawCertificateText(page, text, font, {
    x,
    top,
    width,
    height,
    size: 10,
    minimumSize: 10,
    align: "center",
    verticalAlign: "middle",
    color: rgb(1, 1, 1),
  });
}

function signatures(
  page: PDFPage,
  input: CertificateRenderInput,
  regular: PDFFont,
  bold: PDFFont,
) {
  const approval = input.type === "APPROVAL";
  const left = approval ? 92 : 42;
  const width = approval ? 640 : 528;
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
  const [regular, bold, display, recipient] = await Promise.all([
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
    doc.embedFont(resources.recipient, {
      subset: true,
      customName: "Merriweather-Regular",
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
  // Center the whole award block in the usable paper, not the remainder after
  // an inline label. The landscape axis clears the asymmetric left curve.
  const x = approval ? 92 : 60;
  const width = approval ? 640 : 492;
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
  // Verification retains its own right column, above the recipient area.
  const heading = (text: string, top: number, height: number, size: number) =>
    drawCertificateText(page, text, display, {
      x: approval ? x : 76,
      top,
      width: approval ? width : 376,
      height,
      size,
      minimumSize: size,
      align: "center",
    });
  if (approval) {
    heading("CERTIFICADO", 111, 47, 32);
    certificateBand(page, "DE APROBACIÓN", regular, x + width / 2, 155, 302);
  } else {
    heading("CERTIFICADO", 161, 43, 28);
    certificateBand(page, "DE INSTRUCTOR", regular, 264, 208, 268);
  }
  const verification = approval
    ? { x: 538, top: 105, width: 220, codeHeight: 60 }
    : { x: 414, top: 140, width: 180, codeHeight: 70 };
  const codeBox = {
    x: verification.x,
    top: verification.top + CERTIFICATE_QR_SIZE + 6,
    width: verification.width,
    height: verification.codeHeight,
    size: 8,
    minimumSize: 7,
    align: "center" as const,
  };
  const code = `ID: ${input.publicCredentialId}`;
  const codeLayout = fitCertificateText(code, regular, codeBox);
  // Reclaim the separate label row, but never lift a name into a long ID.
  const recipientTop = Math.max(
    approval ? 222 : 274,
    codeBox.top +
      codeLayout.size +
      (codeLayout.lines.length - 1) * codeLayout.lineHeight +
      4,
  );
  const lift = (approval ? 246 : 294) - recipientTop;
  const label = approval ? "OTORGADO A:" : "A:";
  const labelSize = 10;
  const labelWidth = regular.widthOfTextAtSize(label, labelSize);
  const nameInset = labelWidth + 12;
  const recipientHeight = approval ? 52 : 58;
  // Reserve the label on BOTH sides, preserving the approved name axis.
  // Only the name may wrap; the label shares its first baseline at body left.
  const name = drawCertificateText(page, input.recipientName, recipient, {
    x: x + nameInset,
    top: recipientTop,
    width: width - nameInset * 2,
    height: recipientHeight,
    size: approval ? 24 : 22,
    minimumSize: 14,
    align: "center",
    verticalAlign: "middle",
    color: NAVY,
  });
  drawCertificateText(page, label, regular, {
    x,
    top:
      recipientTop +
      (recipientHeight - name.lines.length * name.lineHeight) / 2 +
      name.size -
      labelSize,
    width: labelWidth,
    height: 16,
    size: labelSize,
    minimumSize: labelSize,
  });
  page.drawLine({
    start: { x: x + 32, y: page.getHeight() - (approval ? 302 : 358) + lift },
    end: {
      x: x + width - 32,
      y: page.getHeight() - (approval ? 302 : 358) + lift,
    },
    thickness: 0.6,
    color: NAVY,
  });
  center(
    content.introduction,
    regular,
    (approval ? 314 : 370) - lift,
    26,
    approval ? 11.2 : 10.5,
    10,
  );
  // No course pictogram was supplied as a separate approved asset. Keep the
  // title prominent; do not extract private screenshots or invent an emblem.
  center(
    content.course,
    bold,
    (approval ? 343 : 400) - lift,
    approval ? 56 : 77,
    approval ? 26 : 25,
    15,
  );
  drawCertificateText(page, content.body, regular, {
    x,
    top: (approval ? 406 : 485) - lift,
    width,
    height: approval ? 53 : 83,
    size: approval ? 11 : 10.5,
    minimumSize: 9.5,
  });
  center(content.date, regular, (approval ? 466 : 578) - lift, 24, 11, 10);
  signatures(page, input, regular, bold);
  drawCertificateQr(
    doc,
    page,
    input.verificationUrl,
    verification.x + (verification.width - CERTIFICATE_QR_SIZE) / 2,
    page.getHeight() - verification.top - CERTIFICATE_QR_SIZE,
  );
  drawCertificateText(page, code, regular, codeBox);
  return doc.save({ useObjectStreams: false });
}
