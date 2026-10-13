import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { and, eq, sql } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegistrationDatabase } from "@/server/db/repositories/registration-support";
import * as s from "@/server/db/schema";
import { DrizzleCertificateRepository } from "@/server/db/repositories/certificate-repository";
import { ManageCertificates } from "@/application/certificates/manage-certificates";
import {
  certificateRecipients,
  validateCertificateConfiguration,
} from "@/domain/certificates/rules";
import { createCertificatePdfRenderer } from "@/server/certificates/renderer";
import { SupabaseCertificateStorage } from "@/server/certificates/storage";
import type { ComprehensiveDemoContext } from "./comprehensive-demo-plan";
import { FULL_VALIDATION_OWNER } from "./full-validation-seed-matrix";
import { fullValidationPlanHash } from "./full-validation-reset-plan";
import {
  assertApprovedDemoMigrationLedger,
  type DemoMigrationLedgerRow,
} from "./approved-demo-migration-ledger";

const requestId = (key: string) => {
  const h = fullValidationPlanHash({ owner: FULL_VALIDATION_OWNER, key });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** A test final document, not a scan or proof of an institutional signature.
 * The visible safety notice is document provenance, never a person's name. */
export async function validationFinalDocument(
  unsigned: Uint8Array,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(unsigned);
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  const notice = "DOCUMENTO DE PRUEBA - SIN FIRMA INSTITUCIONAL";
  for (const page of document.getPages()) {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: 26,
      color: rgb(1, 1, 1),
    });
    page.drawText(notice, {
      font,
      size: 8,
      x: (page.getWidth() - font.widthOfTextAtSize(notice, 8)) / 2,
      y: 10,
      color: rgb(0.55, 0.05, 0.05),
    });
  }
  document.setSubject(
    "Documento sintético de validación técnica; no acredita firma manuscrita o digital institucional.",
  );
  return document.save({ useObjectStreams: false });
}

/** Only the approved current-record flow may execute this stage. No legacy
 * review/issue/revoke/replacement choreography, no manufactured metadata. */
export async function seedCurrentValidationCertificates(
  db: RegistrationDatabase,
  auth: SupabaseClient,
  options: {
    actorId: string;
    operationId: string;
    context: ComprehensiveDemoContext;
    verificationOrigin: string;
    apply: boolean;
    reviewedPlanSha256?: string;
    allowSyntheticFinal?: boolean;
  },
) {
  const repository = new DrizzleCertificateRepository(db);
  const { revision, configuration } = await repository.getSettings(
    options.actorId,
  );
  validateCertificateConfiguration(configuration, true, "INSTRUCTOR");
  if (
    configuration.templateVersion !== "phase9-v2" ||
    configuration.brandingVersion !== "phase9-v1" ||
    [
      configuration.director,
      configuration.dean,
      configuration.departmentHead,
    ].some((signer) => /demo|fictici|ejemplo/iu.test(signer.name))
  )
    throw new Error(
      "Reviewed current v2 institutional settings and natural authorities required",
    );
  const ledger = await db.execute<DemoMigrationLedgerRow>(
    sql`select id,hash,created_at::text as "createdAt" from drizzle.__drizzle_migrations order by id`,
  );
  assertApprovedDemoMigrationLedger(ledger);
  const oldColumns = await db.execute<{ n: number }>(
    sql`select count(*)::integer as n from information_schema.columns where table_schema='public' and table_name='certificates' and column_name in ('replacement_for_id','replaced_by_id')`,
  );
  if (oldColumns[0]?.n !== 0)
    throw new Error(
      "Current-record certificate schema is not available; no legacy generation",
    );
  const fixtures = [];
  for (const key of ["closed", "reclosed"]) {
    const group = options.context.courses[key];
    if (!group?.groupIds[0])
      throw new Error("Reviewed closed course fixture missing");
    const [state] = await db
      .select()
      .from(s.academicGroupStates)
      .where(eq(s.academicGroupStates.groupId, group.groupIds[0]));
    const versions = await db
      .select()
      .from(s.academicClosureVersions)
      .where(eq(s.academicClosureVersions.groupId, group.groupIds[0]));
    const version = versions.find((row) => row.version === state?.lastVersion);
    if (!state?.closed || !version)
      throw new Error("Latest official closed source required");
    for (const type of ["APPROVAL", "INSTRUCTOR"] as const) {
      for (const [index, recipient] of certificateRecipients(
        version.report,
        type,
      ).entries()) {
        if (
          /demo|fictici|ejemplo/iu.test(
            `${recipient.name} ${version.report.courseName} ${version.report.instructorName}`,
          )
        )
          throw new Error("Official source still has old visible names");
        fixtures.push({
          key: `${key}:${type}:${recipient.id}`,
          courseId: group.courseId,
          groupId: group.groupIds[0],
          versionId: version.id,
          closureRevision: state.revision,
          configurationRevision: revision,
          type,
          recipientId: recipient.id,
          final: type === "INSTRUCTOR" ? key === "reclosed" : index % 2 === 0,
        });
      }
    }
  }
  const plan = {
    owner: FULL_VALIDATION_OWNER,
    operationId: options.operationId,
    actorId: options.actorId,
    verificationOrigin: options.verificationOrigin,
    configuration,
    revision,
    fixtures,
    syntheticFinalNotice: "DOCUMENTO DE PRUEBA - SIN FIRMA INSTITUCIONAL",
  };
  const planSha256 = fullValidationPlanHash(plan);
  if (options.reviewedPlanSha256 && options.reviewedPlanSha256 !== planSha256)
    throw new Error("Reviewed current-certificate plan changed");
  if (!options.apply) return { mode: "PLAN" as const, planSha256, plan };
  if (!options.reviewedPlanSha256 || !options.allowSyntheticFinal)
    throw new Error(
      "Reviewed current-certificate hash and explicit synthetic-final approval required",
    );
  const storage = new SupabaseCertificateStorage(auth);
  const service = new ManageCertificates(
    repository,
    storage,
    createCertificatePdfRenderer(),
    options.verificationOrigin,
  );
  const result = [];
  for (const fixture of fixtures) {
    const existing = await db
      .select({ id: s.certificates.id })
      .from(s.certificates)
      .where(
        and(
          eq(s.certificates.groupId, fixture.groupId),
          eq(s.certificates.type, fixture.type),
          eq(s.certificates.recipientId, fixture.recipientId),
        ),
      );
    if (existing.length > 1)
      throw new Error(
        "Current-recipient invariant violated; do not adopt duplicate certificates",
      );
    if (existing.length) {
      const [owned] = await db
        .select({ id: s.certificateReceipts.id })
        .from(s.certificateReceipts)
        .where(
          and(
            eq(s.certificateReceipts.actorId, options.actorId),
            eq(
              s.certificateReceipts.requestKey,
              requestId(`${options.operationId}:generate:${fixture.key}`),
            ),
          ),
        );
      if (!owned)
        throw new Error(
          "Unowned current recipient record appeared; no adoption or overwrite",
        );
    }
    let row = existing[0]
      ? await repository.get(options.actorId, existing[0].id)
      : undefined;
    if (!row || (!row.hasUnsignedPdf && !row.hasSignedPdf)) {
      if (row) {
        const artifacts = await db
          .select()
          .from(s.certificateArtifacts)
          .where(eq(s.certificateArtifacts.certificateId, row.id));
        if (
          artifacts.some(
            (artifact) =>
              artifact.status === "reserved" ||
              artifact.status === "cleanup_pending",
          )
        )
          throw new Error(
            "Generation artifact recovery requires inspection; no blind upload retry",
          );
      }
      const generated = await service.generate(options.actorId, {
        courseId: fixture.courseId,
        groupId: fixture.groupId,
        versionId: fixture.versionId,
        closureRevision: fixture.closureRevision,
        configurationRevision: fixture.configurationRevision,
        requestKey: requestId(`${options.operationId}:generate:${fixture.key}`),
        type: fixture.type,
        recipientId: fixture.recipientId,
      });
      row = generated[0];
    }
    if (!row || row.data.templateVersion !== "phase9-v2")
      throw new Error("Current certificate generation did not produce v2");
    if (fixture.final && !row.hasSignedPdf) {
      const unsigned = await service.download(
        options.actorId,
        row.id,
        "UNSIGNED",
      );
      const final = await validationFinalDocument(unsigned);
      row = await service.uploadSigned(
        options.actorId,
        {
          certificateId: row.id,
          revision: row.revision,
          requestKey: requestId(`${options.operationId}:signed:${fixture.key}`),
        },
        final,
      );
      if (row.state !== "issued" || !row.hasSignedPdf)
        throw new Error(
          "Current upload did not atomically activate signed-current document",
        );
      const actual = await service.download(options.actorId, row.id, "SIGNED");
      if (
        row.signedSha256 !== createHash("sha256").update(actual).digest("hex")
      )
        throw new Error("Authoritative current file hash mismatch");
    }
    result.push({
      id: row.id,
      publicCredentialId: row.publicCredentialId,
      type: row.type,
      state: row.state,
      templateVersion: row.data.templateVersion,
      hasSignedPdf: row.hasSignedPdf,
    });
  }
  return { mode: "APPLIED" as const, planSha256, records: result };
}
