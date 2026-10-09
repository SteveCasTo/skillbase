import { PDFDocument } from "pdf-lib";
import { CertificateError } from "@/domain/certificates/rules";
export const CERTIFICATE_PDF_MAX_BYTES = 10 * 1024 * 1024;
export async function validateCertificatePdf(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  purpose: string,
) {
  if (
    !["SIGNED", "UNSIGNED"].includes(purpose) ||
    mime !== "application/pdf" ||
    !/\.pdf$/iu.test(filename) ||
    !bytes.length ||
    bytes.length > CERTIFICATE_PDF_MAX_BYTES
  )
    throw new CertificateError(
      "VALIDATION_FAILED",
      "Archivo PDF no válido (máximo 10 MiB).",
      { file: "Comprueba formato y tamaño." },
    );
  const header = new TextDecoder().decode(bytes.subarray(0, 8));
  const trailer = new TextDecoder().decode(
    bytes.subarray(Math.max(0, bytes.length - 1024)),
  );
  if (!/^%PDF-(?:1\.[0-9]|2\.0)/u.test(header) || !/%%EOF\s*$/u.test(trailer))
    throw new CertificateError(
      "VALIDATION_FAILED",
      "El archivo no contiene un PDF válido.",
      { file: "Contenido PDF requerido." },
    );
  try {
    const pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    if (!pdf.getPageCount()) throw new Error("Empty PDF");
  } catch {
    throw new CertificateError(
      "VALIDATION_FAILED",
      "No se admite PDF vacío, dañado o cifrado.",
      { file: "PDF legible requerido." },
    );
  }
}
