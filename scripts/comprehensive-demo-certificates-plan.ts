import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  defaultCertificateConfiguration,
  validateCertificateConfiguration,
} from "@/domain/certificates/rules";
import type { CertificateConfiguration } from "@/domain/certificates/types";

export const CERTIFICATE_DEMO_OWNER = "skillbase-comprehensive-certificates-v1";
export const DEMO_PDF_NOTICE = "[DEMO - SIN FIRMA INSTITUCIONAL]";
export const DEMO_CERTIFICATE_REASON =
  "[DEMO] Fixture de revisión/emisión sintética; no acredita firma física ni institucional.";
export function certificateDemoId(key: string) {
  const h = createHash("sha256")
    .update(`${CERTIFICATE_DEMO_OWNER}:${key}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function demoCertificateConfiguration(): CertificateConfiguration {
  const configuration = structuredClone(defaultCertificateConfiguration);
  configuration.director = {
    ...configuration.director,
    name: "[DEMO] Dirección ficticia",
  };
  configuration.dean = {
    ...configuration.dean,
    name: "[DEMO] Decanato ficticio",
  };
  configuration.departmentHead = {
    ...configuration.departmentHead,
    name: "[DEMO] Jefatura ficticia",
  };
  return configuration;
}
/** Existing configuration is never repaired or replaced, including incomplete settings. */
export function assertDemoCertificateConfiguration(
  configuration: CertificateConfiguration,
) {
  validateCertificateConfiguration(configuration, true, "INSTRUCTOR");
  if (
    [
      configuration.director,
      configuration.dean,
      configuration.departmentHead,
    ].some((s) => !s.name.includes("[DEMO]"))
  )
    throw new Error(
      "PLAN BLOCK: existing signatories must be explicitly DEMO; preserve configuration, use a separate QA target.",
    );
  for (const key of [
    "organization",
    "venue",
    "templateVersion",
    "brandingVersion",
  ] as const)
    if (configuration[key] !== defaultCertificateConfiguration[key])
      throw new Error(
        "PLAN BLOCK: existing configuration is incompatible with phase9-v1; do not overwrite it.",
      );
}
/** This is a synthetic final fixture, NOT a signed scan. Stamp actual page content. */
export async function stampDemoFinalPdf(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const page of pdf.getPages()) {
    const width = page.getWidth();
    page.drawRectangle({ x: 0, y: 0, width, height: 32, color: rgb(1, 1, 1) });
    page.drawText(DEMO_PDF_NOTICE, {
      x: (width - font.widthOfTextAtSize(DEMO_PDF_NOTICE, 12)) / 2,
      y: 12,
      size: 12,
      font,
      color: rgb(0.65, 0, 0),
    });
  }
  pdf.setTitle(DEMO_PDF_NOTICE);
  pdf.setSubject(DEMO_CERTIFICATE_REASON);
  return pdf.save();
}
