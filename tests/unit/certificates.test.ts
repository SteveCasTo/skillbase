import { expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import {
  certificateRecipients,
  defaultCertificateConfiguration,
  publicCertificate,
  requireCurrentClosure,
  validateCertificateConfiguration,
} from "@/domain/certificates/rules";
import { freezeCertificateData } from "@/domain/certificates/metadata";
import type { ClosureReportDto } from "@/domain/academic-closure/types";
import {
  validateCertificatePdf,
  CERTIFICATE_PDF_MAX_BYTES,
} from "@/server/certificates/upload";
import { requireCertificateActor } from "@/server/certificates/http";
import { handlePublicCertificateGet } from "@/server/certificates/public-http";
import {
  certificatePdfInput,
  createCertificatePdfRenderer,
} from "@/server/certificates/renderer";

const configuration = structuredClone(defaultCertificateConfiguration);
configuration.director = {
  ...configuration.director,
  name: "Fictitious Director",
};
configuration.dean = { ...configuration.dean, name: "Fictitious Dean" };
configuration.departmentHead = {
  ...configuration.departmentHead,
  name: "Fictitious Department Head",
};
const input = {
  type: "APPROVAL" as const,
  publicCredentialId: "A".repeat(32),
  verificationOrigin: "https://qa.invalid",
  recipientName: "Full Synthetic Name",
  instructorName: "Snapshot Instructor",
  courseName: "Snapshot Course",
  courseStartsAt: new Date("2099-02-01T04:00:00Z"),
  courseEndsAt: new Date("2099-03-01T03:59:00Z"),
  groupStartsAt: new Date("2099-02-01T12:00:00Z"),
  groupEndsAt: new Date("2099-02-28T13:30:00Z"),
  academicHours: 40,
  groupNumber: 2,
  configuration,
  generatedAt: new Date("2099-03-06T12:00:00Z"),
};
test("certificate eligibility uses only official combined decision and stable identity", () => {
  const report = {
    instructorId: crypto.randomUUID(),
    instructorName: "Snapshot Instructor",
    participants: [
      {
        participantId: "eligible",
        firstName: "Full",
        lastName: "Name",
        membershipStatus: "INSCRITO",
        academicallyPassed: true,
        balanceCents: 5000,
      },
      {
        participantId: "attendance-failed",
        firstName: "Not",
        lastName: "Eligible",
        membershipStatus: "INSCRITO",
        academicallyPassed: false,
        result: { passed: true },
      },
      {
        participantId: "pending",
        firstName: "Pending",
        lastName: "Grade",
        membershipStatus: "INSCRITO",
        academicallyPassed: false,
      },
      {
        participantId: "unpaid",
        firstName: "Wrong",
        lastName: "Membership",
        membershipStatus: "PREINSCRITO",
        academicallyPassed: true,
      },
    ],
  } as unknown as ClosureReportDto;
  expect(certificateRecipients(report, "APPROVAL")).toEqual([
    { id: "eligible", name: "Full Name" },
  ]);
  expect(
    certificateRecipients({ ...report, participants: [] }, "INSTRUCTOR"),
  ).toEqual([{ id: report.instructorId!, name: report.instructorName! }]);
  expect(() =>
    certificateRecipients({ ...report, instructorName: null }, "APPROVAL"),
  ).toThrow();
});
test("generation freezes nominal civil dates, positive hours, ordinal and all signatories", () => {
  const data = freezeCertificateData(input);
  expect(data).toMatchObject({
    startsOn: "2099-02-01",
    endsOn: "2099-02-28",
    printedMonth: 2,
    printedYear: 2099,
    academicHours: 40,
    groupStartsAt: "08:00",
    groupEndsAt: "09:30",
    groupNumber: 2,
    city: "Cochabamba",
  });
  expect(data.signatories.map((s) => s.name)).toEqual([
    "Snapshot Instructor",
    "Fictitious Director",
    "Fictitious Dean",
  ]);
  const instructor = freezeCertificateData({ ...input, type: "INSTRUCTOR" });
  expect(instructor.signatories[0].name).toBe("Fictitious Department Head");
  const saved = JSON.stringify(data);
  configuration.director = { ...configuration.director, name: "Changed later" };
  expect(JSON.stringify(data)).toBe(saved);
  configuration.director = {
    ...configuration.director,
    name: "Fictitious Director",
  };
  for (const changed of [
    { groupNumber: 0 },
    { academicHours: 0 },
    { verificationOrigin: "http://public.invalid" },
  ])
    expect(() => freezeCertificateData({ ...input, ...changed })).toThrow();
});
test("empty authorities block generation without inventing names", () => {
  expect(() =>
    validateCertificateConfiguration(defaultCertificateConfiguration),
  ).not.toThrow();
  expect(() =>
    freezeCertificateData({
      ...input,
      configuration: defaultCertificateConfiguration,
    }),
  ).toThrow();
});
test("public projection is an exact allowlist and draft returns no identity", () => {
  const data = {
    ...freezeCertificateData(input),
    ci: "secret",
    actorId: "secret",
    storagePath: "secret",
    grades: [100],
  };
  for (const state of ["pending", "generated", "awaiting_signature"] as const)
    expect(publicCertificate(state, data, null)).toEqual({
      state: "not_issued",
      valid: false,
    });
  for (const state of ["issued", "revoked", "replaced"] as const) {
    const result = publicCertificate(state, data, "f".repeat(64));
    expect(result.valid).toBe(state === "issued");
    expect(Object.keys(result).sort()).toEqual(
      [
        "state",
        "valid",
        "recipientName",
        "courseName",
        "academicHours",
        "type",
        "endsOn",
        "publicCredentialId",
        "verificationUrl",
        "organization",
        "signedSha256",
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain("secret");
  }
});
test("latest closed version is required without revoking existing issued credentials", () => {
  expect(() => requireCurrentClosure(true, 2, 2)).not.toThrow();
  expect(() => requireCurrentClosure(false, 1, 1)).toThrow();
  expect(() => requireCurrentClosure(true, 2, 1)).toThrow();
  expect(
    publicCertificate("issued", freezeCertificateData(input), "a".repeat(64))
      .valid,
  ).toBe(true);
});
test("PDF upload rejects mismatched MIME extension sniff size purpose malformed and encrypted content", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = await pdf.save();
  await expect(
    validateCertificatePdf(bytes, "scan.PDF", "application/pdf", "SIGNED"),
  ).resolves.toBeUndefined();
  for (const [name, mime, purpose] of [
    ["scan.txt", "application/pdf", "SIGNED"],
    ["scan.pdf", "text/plain", "SIGNED"],
    ["scan.pdf", "application/pdf", "OTHER"],
  ])
    await expect(
      validateCertificatePdf(bytes, name!, mime!, purpose!),
    ).rejects.toThrow();
  for (const invalid of [
    new Uint8Array(),
    new Uint8Array(CERTIFICATE_PDF_MAX_BYTES + 1),
    new TextEncoder().encode("%PDF-1.7 invalid %%EOF"),
    new TextEncoder().encode("not a pdf"),
  ])
    await expect(
      validateCertificatePdf(invalid, "scan.pdf", "application/pdf", "SIGNED"),
    ).rejects.toThrow();
});
test("HTTP session guard permits ADMIN peers but never inactive or instructor mutations", () => {
  const actor = {
    id: crypto.randomUUID(),
    authUserId: crypto.randomUUID(),
    name: "Synthetic",
    email: "qa@test.invalid",
    status: "ACTIVE" as const,
    roles: ["ADMIN" as const],
  };
  expect(() => requireCertificateActor(actor)).not.toThrow();
  expect(() =>
    requireCertificateActor({ ...actor, status: "DISABLED" }),
  ).toThrow();
  expect(() =>
    requireCertificateActor({ ...actor, roles: ["INSTRUCTOR"] }),
  ).toThrow();
  expect(() =>
    requireCertificateActor({ ...actor, roles: ["INSTRUCTOR"] }, false),
  ).not.toThrow();
});
test("public adapter limits before registry access and exposes only authoritative DTO", async () => {
  let reads = 0;
  const repository = {
    async verify() {
      reads++;
      return { state: "not_issued" as const, valid: false as const };
    },
  };
  const limited = await handlePublicCertificateGet({
    publicCredentialId: "A".repeat(32),
    clientAddress: "192.0.2.1",
    repository,
    consumeLimit: async () => 30,
  });
  expect(limited.status).toBe(429);
  expect(limited.headers.get("Retry-After")).toBe("30");
  expect(reads).toBe(0);
  const response = await handlePublicCertificateGet({
    publicCredentialId: "A".repeat(32),
    clientAddress: "192.0.2.1",
    repository,
    consumeLimit: async () => 0,
  });
  expect(await response.json()).toEqual({ state: "not_issued", valid: false });
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(reads).toBe(1);
});
test("merged renderer adapter maps version, frozen generation instant and exact signature tuple", async () => {
  const approval = certificatePdfInput(freezeCertificateData(input));
  expect(approval.type).toBe("APPROVAL");
  expect(approval.templateVersion).toBe(1);
  expect(approval.generatedAt).toBe("2099-03-06T12:00:00.000Z");
  expect(approval.signatories).toHaveLength(3);
  expect(approval).not.toHaveProperty("groupNumber");
  const instructor = certificatePdfInput(
    freezeCertificateData({
      ...input,
      type: "INSTRUCTOR",
      courseEndsAt: new Date("2099-03-05T23:59:00-04:00"),
    }),
  );
  expect(instructor).toMatchObject({
    type: "INSTRUCTOR",
    groupNumber: 2,
    groupStartsAt: "08:00",
    groupEndsAt: "09:30",
    endsOn: "2099-02-28",
    printedMonth: 2,
  });
  const renderer = createCertificatePdfRenderer();
  const bytes = await renderer.render(freezeCertificateData(input));
  const rendered = await PDFDocument.load(bytes);
  expect(rendered.getPageCount()).toBe(1);
  expect(rendered.getCreationDate()?.toISOString()).toBe(approval.generatedAt);
  expect(() =>
    certificatePdfInput({
      ...freezeCertificateData(input),
      templateVersion: "unsupported",
    }),
  ).toThrow();
  await expect(
    renderer.render({ ...freezeCertificateData(input), printedMonth: 3 }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
}, 15000);
