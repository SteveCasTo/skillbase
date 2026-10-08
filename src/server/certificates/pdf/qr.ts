import QRCode from "qrcode";
import { PDFString, rgb, type PDFDocument, type PDFPage } from "pdf-lib";
import { CertificatePdfError } from "./types";

export const CERTIFICATE_QR_QUIET_MODULES = 4;
export const CERTIFICATE_QR_SIZE = 72;

export function certificateQrMatrix(verificationUrl: string) {
  const qr = QRCode.create(verificationUrl, { errorCorrectionLevel: "M" });
  const moduleSize =
    CERTIFICATE_QR_SIZE / (qr.modules.size + 2 * CERTIFICATE_QR_QUIET_MODULES);
  // At least 0.4 mm per module, including at a real 100% Letter print size.
  if (moduleSize < (0.4 * 72) / 25.4)
    throw new CertificatePdfError(
      "PDF_QR_TOO_DENSE",
      "La URL de verificación es demasiado extensa para el QR de la plantilla.",
    );
  return qr.modules;
}

/** Vector modules, four white quiet-zone modules on all sides. No pseudo-QR,
 * raster resampling, network service, personal data payload or printed URL. */
export function drawCertificateQr(
  doc: PDFDocument,
  page: PDFPage,
  url: string,
  x: number,
  y: number,
) {
  const matrix = certificateQrMatrix(url);
  const size = CERTIFICATE_QR_SIZE;
  const unit = size / (matrix.size + 2 * CERTIFICATE_QR_QUIET_MODULES);
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
  for (let row = 0; row < matrix.size; row++) {
    for (let column = 0; column < matrix.size; column++) {
      if (!matrix.get(row, column)) continue;
      page.drawRectangle({
        x: x + (column + CERTIFICATE_QR_QUIET_MODULES) * unit,
        y: y + size - (row + CERTIFICATE_QR_QUIET_MODULES + 1) * unit,
        width: unit,
        height: unit,
        color: rgb(0, 0, 0),
      });
    }
  }
  page.node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [x, y, x + size, y + size],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
      }),
    ),
  );
}
