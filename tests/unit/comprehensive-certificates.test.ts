import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFRawStream, PDFName, PDFArray } from "pdf-lib";
import { defaultCertificateConfiguration } from "@/domain/certificates/rules";
import {
  parseComprehensiveArgs,
  comprehensiveDemoId,
} from "../../scripts/comprehensive-demo-plan";
import {
  certificateDemoId,
  demoCertificateConfiguration,
  assertDemoCertificateConfiguration,
  stampDemoFinalPdf,
  DEMO_PDF_NOTICE,
} from "../../scripts/comprehensive-demo-certificates-plan";

test("F9 opt-in is explicit and IDs do not collide with the preserved F8 namespace", () => {
  expect(
    parseComprehensiveArgs(["--target", "local", "--project", "local"])
      .includeCertificates,
  ).toBe(false);
  expect(
    parseComprehensiveArgs([
      "--target",
      "local",
      "--project",
      "local",
      "--include-certificates",
    ]).includeCertificates,
  ).toBe(true);
  expect(certificateDemoId("manifest")).toBe(certificateDemoId("manifest"));
  expect(certificateDemoId("manifest")).not.toBe(
    comprehensiveDemoId("manifest"),
  );
});
test("existing incomplete, real signatories or incompatible branding block without mutating configuration", () => {
  const defaults = structuredClone(defaultCertificateConfiguration);
  expect(() => assertDemoCertificateConfiguration(defaults)).toThrow();
  expect(defaults).toEqual(defaultCertificateConfiguration);
  const valid = demoCertificateConfiguration();
  expect(() => assertDemoCertificateConfiguration(valid)).not.toThrow();
  for (const key of ["director", "dean", "departmentHead"] as const) {
    const config = structuredClone(valid);
    config[key] = { ...config[key], name: "Not a DEMO identity" };
    expect(() => assertDemoCertificateConfiguration(config)).toThrow(
      "PLAN BLOCK",
    );
  }
  const unsupported = { ...valid, brandingVersion: "unknown" };
  expect(() => assertDemoCertificateConfiguration(unsupported)).toThrow(
    "PLAN BLOCK",
  );
});
test("final fixture stamp is readable actual page content on every page, not just metadata", async () => {
  const document = await PDFDocument.create();
  document.addPage([792, 612]);
  document.addPage([612, 792]);
  const stamped = await PDFDocument.load(
    await stampDemoFinalPdf(await document.save()),
  );
  expect(stamped.getPageCount()).toBe(2);
  const expected = Buffer.from(DEMO_PDF_NOTICE).toString("hex").toUpperCase();
  for (const page of stamped.getPages()) {
    const streams = page.node.Contents();
    expect(streams).toBeDefined();
    if (!(streams instanceof PDFArray))
      throw new Error("Expected stamped content stream array");
    const text = Array.from({ length: streams!.size() }, (_, index) => {
      const stream = streams!.lookup(index, PDFRawStream);
      const bytes =
        stream.dict.get(PDFName.of("Filter"))?.toString() === "/FlateDecode"
          ? inflateSync(stream.contents)
          : stream.contents;
      return new TextDecoder().decode(bytes);
    }).join("\n");
    expect(text).toContain(expected);
    expect(text).toContain("12 Tf");
  }
});
