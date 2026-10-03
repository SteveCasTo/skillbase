import { expect, spyOn, test } from "bun:test";
import { PDFDocument, PDFPage } from "pdf-lib";
import {
  csvText,
  renderRegistrationsCsv,
} from "@/server/pre-registrations/exports/csv";
import { createRegistrationExportPort } from "@/server/pre-registrations/exports";
import {
  RegistrationPdfTextError,
  renderRegistrationsPdf,
} from "@/server/pre-registrations/exports/pdf";
import { exportNow, exportRow } from "./registration-export-fixture";

test("CSV is UTF-8 BOM, comma-separated CRLF, quoted accents and exact integer-cent decimals", () => {
  const bytes = renderRegistrationsCsv([exportRow()]);
  expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
  const value = new TextDecoder().decode(bytes);
  expect(value).toBe(
    '"Curso","Grupo","Nombres","Apellidos","CI","Categoría","Estado","Estado financiero","Precio BOB","Pagado BOB","Saldo BOB","Devuelto BOB","Por devolver BOB"\r\n"Diseño y programación","Grupo mañana","María José","Muñoz","\'000123-LP","Estudiante","Preinscrito","Pago parcial",80.01,20.01,60.00,0.00,0.00\r\n',
  );
  expect(value).not.toContain("participant-private");
  expect(value).not.toContain("private-interest");
  expect(value).not.toContain("private-tariff");
});
test.each([
  "=1+1",
  "+SUM(A1)",
  "-cmd",
  "@SUM(A1)",
  " \t=1",
  "\u200b=1",
  "\uFEFF+1",
  "\ttext",
  "\rtext",
  "\ntext",
  " \u200b\ttext",
])("defangs dangerous CSV text %j", (value) => {
  expect(csvText(value)).toBe(`"'${value}"`);
});
test("CSV quotes embedded separators, quotes and newlines without creating fake records", () => {
  expect(csvText('a,"b"\r\nc')).toBe('"a,""b""\r\nc"');
  expect(csvText("000123", true)).toBe('"\'000123"');
  expect(csvText("Élève")).toBe('"Élève"');
  expect(renderRegistrationsCsv([]).length).toBeGreaterThan(0);
});
test("PDF is real paginated A4 landscape with repeated headings, full names and consistent totals", async () => {
  const draw = spyOn(PDFPage.prototype, "drawText");
  try {
    const rows = Array.from({ length: 30 }, (_, i) => exportRow(i));
    rows[0] = {
      ...exportRow(0),
      participant: {
        ...exportRow().participant,
        firstName: "Ángela Ω Иван",
        lastName: "Muñoz ".repeat(20).trim(),
      },
    };
    const bytes = await renderRegistrationsPdf(rows, exportNow);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(
      pdf
        .getPages()
        .every(
          (page) =>
            Math.abs(page.getWidth() - 841.89) < 0.01 &&
            Math.abs(page.getHeight() - 595.28) < 0.01,
        ),
    ).toBe(true);
    expect(pdf.getCreationDate()?.toISOString()).toBe(exportNow.toISOString());
    expect(pdf.getTitle()).toBe("Preinscripciones — listado administrativo");
    const text = draw.mock.calls.map(([value]) => value);
    expect(
      text.filter((value) => value === "Participante / CI / categoría"),
    ).toHaveLength(pdf.getPageCount());
    expect(text.filter((value) => value === "Precio BOB")).toHaveLength(
      pdf.getPageCount(),
    );
    expect(text).toContain("Ángela Ω Иван");
    expect(
      text.filter((value) => value === "Curso: Diseño y programación"),
    ).toHaveLength(pdf.getPageCount());
    expect(
      text.filter((value) => value === "Grupo: Grupo mañana"),
    ).toHaveLength(pdf.getPageCount());
    expect(text.join("")).not.toContain(exportRow().courseId);
    expect(text.join("")).not.toContain(exportRow().groupId);
    expect(text.filter((value) => value.includes("Muñoz")).join("")).toContain(
      "Muñoz ".repeat(19),
    );
    expect(text.some((value) => value.includes("Precio BOB: 2400.30"))).toBe(
      true,
    );
    expect(
      text.some((value) => value.includes("2099-03-01 22:03 (Bolivia UTC-04)")),
    ).toBe(true);
    expect(text.join("")).not.toContain("participant-private");
    expect(text.join("")).not.toContain("private-interest");
    expect(text.join("")).not.toContain("private-tariff");
    expect(text).toContain(
      `Uso exclusivo ADMIN · Página ${pdf.getPageCount()} de ${pdf.getPageCount()}`,
    );
  } finally {
    draw.mockRestore();
  }
});
test("PDF refuses unsupported Unicode explicitly; CSV retains it losslessly", async () => {
  const row = {
    ...exportRow(),
    participant: { ...exportRow().participant, lastName: "李" },
  };
  await expect(renderRegistrationsPdf([row], exportNow)).rejects.toBeInstanceOf(
    RegistrationPdfTextError,
  );
  expect(new TextDecoder().decode(renderRegistrationsCsv([row]))).toContain(
    "李",
  );
});
test("empty PDF is readable and injected factory clock controls its metadata", async () => {
  const port = createRegistrationExportPort(() => exportNow);
  const pdf = await PDFDocument.load(await port.render("PDF", []), {
    updateMetadata: false,
  });
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getCreationDate()?.toISOString()).toBe(exportNow.toISOString());
  expect(await port.render("CSV", [])).toEqual(renderRegistrationsCsv([]));
});

test("exports projected refund liabilities and exemptions without recalculating finance", () => {
  const row = exportRow();
  const cancelled = {
    ...row,
    state: "CANCELLED" as const,
    membershipStatus: "CANCELADO" as const,
    financialStatus: "REFUND_DUE" as const,
    refundedCents: 501,
    refundDueCents: 1500,
    balanceCents: 0,
  };
  const value = new TextDecoder().decode(renderRegistrationsCsv([cancelled]));
  expect(value).toContain(
    '"Cancelado","Devolución pendiente",80.01,20.01,0.00,5.01,15.00',
  );
  const exempt = {
    ...row,
    price: {
      ...row.price,
      participantType: "AUXILIARY" as const,
      totalPriceCents: 0,
    },
    financialStatus: "EXEMPT" as const,
    membershipStatus: "INSCRITO" as const,
    paidCents: 0,
    balanceCents: 0,
  };
  expect(new TextDecoder().decode(renderRegistrationsCsv([exempt]))).toContain(
    '"Auxiliar","Inscrito","Exento",0.00,0.00,0.00,0.00,0.00',
  );
});

test("PDF handles the full technical row limit without truncating participants", async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    ...exportRow(i),
    participant: {
      ...exportRow(i).participant,
      firstName: `María José ${i}`,
      ci: `000${i}-LP`,
    },
  }));
  const bytes = await renderRegistrationsPdf(rows, exportNow);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(pdf.getPageCount()).toBeGreaterThan(100);
  expect(bytes.length).toBeGreaterThan(50_000);
}, 20_000);

test("CSV quotes and defangs course/group names rather than exporting UUID-only cells", () => {
  const row = {
    ...exportRow(),
    courseName: ' \u200b=HYPERLINK("test")',
    groupName: 'Grupo, "Ñ"',
  };
  const text = new TextDecoder().decode(renderRegistrationsCsv([row]));
  expect(text).toContain('"\' \u200b=HYPERLINK(""test"")","Grupo, ""Ñ"""');
  expect(text).not.toContain(row.courseId);
  expect(text).not.toContain(row.groupId);
});

test("legacy rows alone use explicitly marked course/group ID fallbacks", async () => {
  const row = { ...exportRow() };
  Reflect.deleteProperty(row, "courseName");
  Reflect.deleteProperty(row, "groupName");
  const csv = new TextDecoder().decode(renderRegistrationsCsv([row]));
  expect(csv).toContain(`"Curso [${row.courseId}]","Grupo [${row.groupId}]"`);
  const draw = spyOn(PDFPage.prototype, "drawText");
  try {
    await renderRegistrationsPdf([row], exportNow);
    const text = draw.mock.calls.map(([value]) => value);
    expect(text).toContain(`Curso: Curso [${row.courseId}]`);
    expect(text).toContain(`Grupo: Grupo [${row.groupId}]`);
  } finally {
    draw.mockRestore();
  }
});

test("PDF wraps complete long course/group labels above rows and repeats them on each page", async () => {
  const row = {
    ...exportRow(),
    courseName: "Diseño y programación avanzada · ".repeat(8),
    groupName: "Grupo de formación de la mañana · ".repeat(8),
  };
  const draw = spyOn(PDFPage.prototype, "drawText");
  try {
    const pdf = await PDFDocument.load(
      await renderRegistrationsPdf(
        Array.from({ length: 20 }, (_, i) => ({
          ...row,
          id: `registration-${i}`,
        })),
        exportNow,
      ),
    );
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const text = draw.mock.calls.map(([value]) => value).join("");
    expect(text.split(`Curso: ${row.courseName}`).length - 1).toBe(
      pdf.getPageCount(),
    );
    expect(text.split(`Grupo: ${row.groupName}`).length - 1).toBe(
      pdf.getPageCount(),
    );
    let headingY = 0;
    for (const [value, options] of draw.mock.calls) {
      if (value === "Por devolver BOB") headingY = options?.y ?? 0;
      if (value === row.participant.firstName)
        expect(options?.y).toBeLessThan(headingY);
    }
  } finally {
    draw.mockRestore();
  }
});
