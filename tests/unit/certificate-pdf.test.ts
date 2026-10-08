import { expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import QRCode from "qrcode";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
} from "pdf-lib";
import {
  CERTIFICATE_PAGE_SIZES,
  CERTIFICATE_PDF_TEMPLATE_VERSION,
  renderCertificatePdf,
  type CertificateRenderInput,
} from "@/server/certificates/pdf";
import { certificateDocument } from "@/server/certificates/pdf/document";
import {
  CERTIFICATE_QR_QUIET_MODULES,
  CERTIFICATE_QR_SIZE,
  certificateQrMatrix,
  drawCertificateQr,
} from "@/server/certificates/pdf/qr";
import { certificateResources } from "@/server/certificates/pdf/resources";

function fixture(
  type: "APPROVAL" | "INSTRUCTOR" = "APPROVAL",
): CertificateRenderInput {
  const base = {
    publicCredentialId: "DEMO_8jYgB3Zw_xz45SvW6nP0N7OQ",
    verificationUrl:
      "https://demo.example.invalid/certificados/DEMO_8jYgB3Zw_xz45SvW6nP0N7OQ",
    recipientName: "DEMOSTRACIÓN ÑÚÑEZ, MARÍA ÁNGELA",
    courseName: "Mantenimiento y Reparación de Impresoras DEMO",
    instructorName: "Docente histórico DEMO",
    startsOn: "2026-07-23",
    endsOn: "2026-08-05",
    academicHours: 20,
    city: "Cochabamba",
    printedMonth: 8,
    printedYear: 2026,
    signatories: [
      {
        name: "Docente histórico DEMO",
        role: "INSTRUCTOR",
        affiliation: "DPTO. INFORMÁTICA-SISTEMAS",
      },
      {
        name: "Responsable académico DEMO",
        role: "DIRECTOR ACADÉMICO",
        affiliation: "FCyT - UMSS",
      },
      {
        name: "Responsable decanato DEMO",
        role: "DECANO",
        affiliation: "FCyT - UMSS",
      },
    ] as const,
    templateVersion: CERTIFICATE_PDF_TEMPLATE_VERSION,
    generatedAt: "2026-10-08T18:00:00.000Z",
  };
  return type === "APPROVAL"
    ? { ...base, type }
    : {
        ...base,
        type,
        groupNumber: 12,
        groupStartsAt: "11:30",
        groupEndsAt: "13:00",
        courseName: "Automatización con Python DEMO",
        signatories: [
          {
            name: "Responsable jefatura DEMO",
            role: "JEFE DEPARTAMENTO",
            affiliation: "INFORMÁTICA Y SISTEMAS",
          },
          base.signatories[1],
          base.signatories[2],
        ],
      };
}

function streamText(stream: PDFRawStream) {
  const filter = stream.dict.get(PDFName.of("Filter"));
  const bytes =
    filter?.toString() === "/FlateDecode"
      ? inflateSync(stream.contents)
      : stream.contents;
  return new TextDecoder().decode(bytes);
}

/** Decode actual PDF content with its embedded ToUnicode maps. No source-string
 * assertions masquerading as PDF text coverage and no new parser dependency. */
function extractedLines(doc: PDFDocument): string[] {
  const page = doc.getPage(0);
  const fontDict = page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
  const maps = new Map<string, Map<string, string>>();
  for (const key of fontDict.keys()) {
    const font = fontDict.lookup(key, PDFDict);
    const cmapStream = font.lookup(PDFName.of("ToUnicode"));
    if (!(cmapStream instanceof PDFRawStream))
      throw new Error("Missing PDF ToUnicode stream");
    const cmap = streamText(cmapStream);
    const map = new Map<string, string>();
    for (const match of cmap.matchAll(/<([0-9a-f]{4})>\s*<([0-9a-f]+)>/gi)) {
      const encoded = match[2]!;
      let value = "";
      for (let i = 0; i < encoded.length; i += 4)
        value += String.fromCharCode(parseInt(encoded.slice(i, i + 4), 16));
      map.set(match[1]!.toUpperCase(), value);
    }
    maps.set(key.toString(), map);
  }
  const streams = page.node.Contents() as PDFArray;
  const result: string[] = [];
  for (let index = 0; index < streams.size(); index++) {
    const contents = streamText(streams.lookup(index, PDFRawStream));
    let currentFont = "";
    for (const match of contents.matchAll(
      /(\/[^\s]+)\s+[\d.]+\s+Tf|<([0-9a-f]+)>\s*Tj/gi,
    )) {
      if (match[1]) currentFont = match[1];
      else {
        const value = match[2]!;
        let text = "";
        for (let i = 0; i < value.length; i += 4) {
          const decoded = maps
            .get(currentFont)
            ?.get(value.slice(i, i + 4).toUpperCase());
          if (decoded === undefined)
            throw new Error("Missing PDF glyph mapping");
          text += decoded;
        }
        result.push(text);
      }
    }
  }
  return result;
}

test("approved supplied logos remain byte-identical raster assets and embed their alpha masks", async () => {
  const resources = await certificateResources();
  const files = ["umss.png", "fcyt.png", "informatica-sistemas.png"];
  const hashes = [
    "b151c5b0b4aad1203fa5bf0b0c0fbdb81e0427c76ca26fb30aa05baf809bea7a",
    "0704e578b0fabd0fc99a964ceb2d064679b8a45c65681d7a01b45d47a5a8d9cb",
    "63790acfb454df2b89349f0fd3642658bb13dabfed4cf86c133a9aba5ec6340f",
  ];
  for (const [index, file] of files.entries()) {
    const original = await readFile(
      new URL(`../../assets/certificates/${file}`, import.meta.url),
    );
    expect(
      createHash("sha256").update(Uint8Array.from(original)).digest("hex"),
    ).toBe(hashes[index]!);
    expect(resources.logos[index]).toEqual(new Uint8Array(original));
    expect(original.readUInt32BE(16)).toBe(2172);
    expect(original.readUInt32BE(20)).toBe(724);
    expect(original[25]).toBe(6); // PNG RGBA, not a black-background replacement.
  }
  const doc = await PDFDocument.load(await renderCertificatePdf(fixture()));
  const objects = doc
    .getPage(0)
    .node.Resources()!
    .lookup(PDFName.of("XObject"), PDFDict);
  expect(objects.keys()).toHaveLength(3);
  for (const key of objects.keys()) {
    const image = objects.lookup(key);
    if (!(image instanceof PDFRawStream))
      throw new Error("Missing PDF image stream");
    expect(image.dict.has(PDFName.of("SMask"))).toBe(true);
  }
});

for (const type of ["APPROVAL", "INSTRUCTOR"] as const) {
  test(`${type} produces exactly one Letter page with frozen fields, Unicode and three signature blocks`, async () => {
    const input = fixture(type);
    const bytes = await renderCertificatePdf(input);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({
      width: CERTIFICATE_PAGE_SIZES[type][0],
      height: CERTIFICATE_PAGE_SIZES[type][1],
    });
    expect(doc.getTitle()).toBe(
      type === "APPROVAL"
        ? "Certificado de aprobación"
        : "Certificado de instructor",
    );
    expect(doc.getCreationDate()).toEqual(new Date(input.generatedAt));
    expect(doc.getModificationDate()).toEqual(new Date(input.generatedAt));
    const lines = extractedLines(doc);
    const text = lines.join(" ");
    for (const value of [
      input.recipientName,
      certificateDocument(input).course,
      "Laboratorio de Cómputo",
      "del 23 de julio al 05 de agosto de 2026",
      "20 horas académicas.",
      "Cochabamba, agosto 2026",
      `ID: ${input.publicCredentialId}`,
    ])
      expect(text).toContain(value);
    for (const signer of input.signatories) {
      expect(lines.filter((line) => line === signer.name)).toHaveLength(1);
      expect(text).toContain(signer.role);
      expect(text).toContain(signer.affiliation);
    }
    expect(text).not.toMatch(/CI:|saldo|nota|asistencia|boleta|https?:\/\//i);
    if (type === "APPROVAL") {
      expect(text).toContain("DE APROBACIÓN");
      expect(text).toContain(
        "Por haber completado satisfactoriamente el curso intensivo de :",
      );
      expect(text).not.toContain("GRUPO");
    } else {
      expect(text).toContain("INSTRUCTOR");
      expect(text).not.toContain("APROBACIÓN");
      expect(text).toContain("Por haber IMPARTIDO el curso intensivo de:");
      expect(text).toContain(
        "GRUPO 12, en horario de 11:30 a 13:00, realizado",
      );
    }
    expect(bytes).toEqual(await renderCertificatePdf(input));
  });
}

test("real vector QR matches every library matrix module, axis orientation, white quiet zone and target link", async () => {
  const input = fixture();
  const doc = await PDFDocument.create();
  const page = doc.addPage([792, 612]);
  const draw = spyOn(page, "drawRectangle");
  drawCertificateQr(doc, page, input.verificationUrl, 112, 12);
  const matrix = QRCode.create(input.verificationUrl, {
    errorCorrectionLevel: "M",
  }).modules;
  const unit =
    CERTIFICATE_QR_SIZE / (matrix.size + 2 * CERTIFICATE_QR_QUIET_MODULES);
  expect(draw.mock.calls[0]![0]).toMatchObject({
    x: 112,
    y: 12,
    width: 72,
    height: 72,
    color: { red: 1, green: 1, blue: 1 },
  });
  let index = 1;
  for (let row = 0; row < matrix.size; row++) {
    for (let column = 0; column < matrix.size; column++) {
      if (!matrix.get(row, column)) continue;
      expect(draw.mock.calls[index++]![0]).toMatchObject({
        x: 112 + (column + 4) * unit,
        y: 12 + 72 - (row + 5) * unit,
        width: unit,
        height: unit,
        color: { red: 0, green: 0, blue: 0 },
      });
    }
  }
  expect(draw.mock.calls).toHaveLength(index);
  expect((unit * 25.4) / 72).toBeGreaterThanOrEqual(0.4);
  draw.mockRestore();
  const loaded = await PDFDocument.load(await doc.save());
  const annotations = loaded.getPage(0).node.Annots()!;
  expect(annotations.size()).toBe(1);
  const action = annotations
    .lookup(0, PDFDict)
    .lookup(PDFName.of("A"), PDFDict);
  expect(action.lookup(PDFName.of("URI"), PDFString).decodeText()).toBe(
    input.verificationUrl,
  );
});

test("long identities, course names and signatories wrap without truncation or a second page", async () => {
  for (const type of ["APPROVAL", "INSTRUCTOR"] as const) {
    const original = fixture(type);
    const input: CertificateRenderInput = {
      ...original,
      recipientName:
        "DEMOSTRACIÓN ÑÚÑEZ DE LA PEÑA, MARÍA ÁNGELA DEL VALLE DE LOS ANDES",
      courseName:
        "Mantenimiento y Reparación de Sistemas de Impresión y Automatización DEMO",
      signatories: [
        {
          ...original.signatories[0],
          name: "Responsable de formación académica DEMO Ñúñez",
        },
        {
          ...original.signatories[1],
          name: "Responsable de dirección académica DEMO Álvarez",
        },
        original.signatories[2],
      ],
    };
    const doc = await PDFDocument.load(await renderCertificatePdf(input));
    expect(doc.getPageCount()).toBe(1);
    const text = extractedLines(doc).join(" ");
    expect(text).toContain(input.recipientName);
    expect(text).toContain(certificateDocument(input).course);
    for (const signer of input.signatories) expect(text).toContain(signer.name);
  }
});

test("civil date formatting preserves nominal end month and both years across a year boundary", async () => {
  const input = {
    ...fixture(),
    startsOn: "2025-12-29",
    endsOn: "2026-01-09",
    printedMonth: 1,
    academicHours: 20.5,
  };
  const doc = await PDFDocument.load(await renderCertificatePdf(input));
  const text = extractedLines(doc).join(" ");
  expect(text).toContain("29 de diciembre de 2025 al 09 de enero de 2026");
  expect(text).toContain("20,5 horas académicas.");
  expect(text).toContain("Cochabamba, enero 2026");
  expect(text).not.toContain("octubre");
});

test("rejects unsupported text, overflow and unknown frozen template versions instead of changing identity", async () => {
  await expect(
    renderCertificatePdf({ ...fixture(), recipientName: "DEMO 漢字" }),
  ).rejects.toMatchObject({ code: "PDF_UNSUPPORTED_TEXT" });
  await expect(
    renderCertificatePdf({
      ...fixture(),
      courseName: "DEMO " + "Á".repeat(800),
    }),
  ).rejects.toMatchObject({ code: "PDF_TEXT_OVERFLOW" });
  await expect(
    renderCertificatePdf({ ...fixture(), templateVersion: 99 }),
  ).rejects.toMatchObject({ code: "PDF_TEMPLATE_VERSION_UNSUPPORTED" });
});

test("rejects invalid frozen dates, mismatched end month, unsafe/mismatched QR URLs and group times", async () => {
  for (const patch of [
    { startsOn: "2026-02-30" },
    { endsOn: "2026-01-01" },
    { printedMonth: 10 },
    { generatedAt: "not-a-date" },
    { verificationUrl: "https://demo.example.invalid/certificados/other" },
    {
      verificationUrl:
        "http://demo.example.invalid/certificados/DEMO_8jYgB3Zw_xz45SvW6nP0N7OQ",
    },
    { verificationUrl: "javascript:alert(1)" },
    { academicHours: Number.NaN },
  ])
    await expect(
      renderCertificatePdf({ ...fixture(), ...patch }),
    ).rejects.toMatchObject({ code: "PDF_INVALID_INPUT" });
  const instructor = fixture("INSTRUCTOR");
  if (instructor.type !== "INSTRUCTOR") throw new Error();
  for (const patch of [
    { groupNumber: 0 },
    { groupStartsAt: "25:00" },
    { groupEndsAt: "11:00" },
  ])
    await expect(
      renderCertificatePdf({ ...instructor, ...patch }),
    ).rejects.toMatchObject({ code: "PDF_INVALID_INPUT" });
  expect(() => certificateQrMatrix("https://" + "a".repeat(440))).toThrow();
  const local = {
    ...fixture(),
    verificationUrl: `http://127.0.0.1:4321/certificados/${fixture().publicCredentialId}`,
  };
  expect((await renderCertificatePdf(local)).length).toBeGreaterThan(0);
});
