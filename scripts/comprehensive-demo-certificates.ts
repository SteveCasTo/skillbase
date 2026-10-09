import { and, eq, sql } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as s from "@/server/db/schema";
import type { RegistrationDatabase } from "@/server/db/repositories/registration-support";
import { requireFreshRegistrationActor } from "@/server/db/repositories/registration-support";
import { lockInstructorSchedules } from "@/server/db/repositories/instructor-schedule";
import { DrizzleCertificateRepository } from "@/server/db/repositories/certificate-repository";
import { ManageCertificates } from "@/application/certificates/manage-certificates";
import { createCertificatePdfRenderer } from "@/server/certificates/renderer";
import { SupabaseCertificateStorage } from "@/server/certificates/storage";
import { certificateRecipients } from "@/domain/certificates/rules";
import type {
  CertificateDto,
  GenerateCertificatesInput,
} from "@/domain/certificates/types";
import {
  comprehensiveDemoId,
  COMPREHENSIVE_DEMO_OWNER,
  type ComprehensiveDemoContext,
} from "./comprehensive-demo-plan";
import { fingerprint } from "./financial-demo-plan";
import {
  assertApprovedDemoMigrationLedger,
  readApprovedDemoMigrations,
  type DemoMigrationLedgerRow,
} from "./approved-demo-migration-ledger";
import {
  CERTIFICATE_DEMO_OWNER,
  certificateDemoId,
  demoCertificateConfiguration,
  assertDemoCertificateConfiguration,
  stampDemoFinalPdf,
  DEMO_CERTIFICATE_REASON,
} from "./comprehensive-demo-certificates-plan";

const manifestId = certificateDemoId("manifest");
const completeId = certificateDemoId("complete");
const scenarios = [
  "generated",
  "awaiting_signature",
  "issued",
  "revoked",
  "replaced",
] as const;
type Fixture = {
  key: string;
  scenario: (typeof scenarios)[number];
  input: GenerateCertificatesInput;
  recipientName: string;
};
export interface CertificateDemoOptions {
  actorId: string;
  auth: SupabaseClient;
  apply: boolean;
  verificationOrigin: string;
  expectedPlanHash?: string;
  preview?: (plan: CertificateDemoPlan) => void;
}
export type CertificateDemoPlan = Awaited<ReturnType<typeof planCertificates>>;

async function planCertificates(
  db: RegistrationDatabase,
  options: CertificateDemoOptions,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`set transaction isolation level repeatable read read only`,
    );
    const ledger = await tx.execute<DemoMigrationLedgerRow>(
      sql`select id,hash,created_at::text as "createdAt" from drizzle.__drizzle_migrations order by id`,
    );
    assertApprovedDemoMigrationLedger(ledger);
    if (readApprovedDemoMigrations().length !== 24)
      throw new Error(
        "F9 requires source/schema ledger 24; no migrations performed",
      );
    const [operator] = await tx
      .select()
      .from(s.users)
      .where(eq(s.users.id, options.actorId));
    const [permission] = await tx
      .select()
      .from(s.userRoles)
      .where(
        and(
          eq(s.userRoles.userId, options.actorId),
          eq(s.userRoles.roleCode, "ADMIN"),
        ),
      );
    if (!operator || operator.status !== "ACTIVE" || !permission)
      throw new Error("Active original ADMIN required for read-only planning");
    const [f8] = await tx
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, comprehensiveDemoId("manifest")));
    if (
      !f8 ||
      f8.actorId !== options.actorId ||
      f8.metadata.seedOwner !== COMPREHENSIVE_DEMO_OWNER ||
      f8.action !== "DEMO_SEEDED"
    )
      throw new Error("PLAN BLOCK: completed owned F8 manifest required");
    const context: ComprehensiveDemoContext = JSON.parse(
      String(f8.metadata.context),
    );
    if (
      context.owner !== COMPREHENSIVE_DEMO_OWNER ||
      fingerprint(context) !== f8.metadata.contextHash
    )
      throw new Error("Invalid F8 provenance");
    const actorId = context.admins.operator!;
    const [actor] = await tx
      .select()
      .from(s.users)
      .where(eq(s.users.id, actorId));
    if (
      !actor ||
      actor.email !== "comprehensive.v1.operator@example.test" ||
      !actor.name.toLowerCase().includes("demo") ||
      actor.status !== "ACTIVE"
    )
      throw new Error("Known fictitious F8 operator required");
    const roles = await tx
      .select()
      .from(s.userRoles)
      .where(eq(s.userRoles.userId, actorId));
    if (!roles.some((r) => r.roleCode === "ADMIN"))
      throw new Error("Fictitious ADMIN role required");
    const [settings] = await tx
      .select()
      .from(s.certificateSettings)
      .where(eq(s.certificateSettings.id, 1));
    // getSettings is read-only, even when defaults/revision zero are returned.
    const config = settings?.configuration ?? demoCertificateConfiguration();
    assertDemoCertificateConfiguration(config);
    const [manifest] = await tx
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, manifestId));
    let fixtures: Fixture[] = [];
    const sources = [];
    for (const key of ["closed", "reclosed"]) {
      const owned = context.courses[key]!;
      const groupId = owned.groupIds[0]!;
      const [state] = await tx
        .select()
        .from(s.academicGroupStates)
        .where(eq(s.academicGroupStates.groupId, groupId));
      const [version] = await tx
        .select()
        .from(s.academicClosureVersions)
        .where(
          and(
            eq(s.academicClosureVersions.groupId, groupId),
            eq(s.academicClosureVersions.version, state?.lastVersion ?? 0),
          ),
        );
      const [course] = await tx
        .select()
        .from(s.courses)
        .where(eq(s.courses.id, owned.courseId));
      const [group] = await tx
        .select()
        .from(s.groups)
        .where(eq(s.groups.id, groupId));
      if (
        !state?.closed ||
        !version ||
        !course ||
        !group ||
        !version.report.courseName.includes("[DEMO]") ||
        !context.instructors.includes(version.report.instructorId ?? "") ||
        version.report.instructorId !== course.instructorId
      )
        throw new Error(
          "PLAN BLOCK: current closed F8 DEMO source with assigned snapshot instructor required",
        );
      sources.push({ state, version, course, group });
      for (const type of ["APPROVAL", "INSTRUCTOR"] as const) {
        for (const recipient of certificateRecipients(version.report, type)) {
          if (!recipient.name.toLowerCase().includes("demo"))
            throw new Error("Real recipient forbidden");
          const fixtureKey = `${key}:${type}:${recipient.id}`;
          fixtures.push({
            key: fixtureKey,
            recipientName: recipient.name,
            scenario: scenarios[fixtures.length % scenarios.length]!,
            input: {
              courseId: course.id,
              groupId,
              versionId: version.id,
              closureRevision: state.revision,
              configurationRevision: settings?.revision ?? 1,
              requestKey: certificateDemoId(`generate:${fixtureKey}`),
              type,
              recipientId: recipient.id,
            },
          });
        }
      }
    }
    if (fixtures.length < 5)
      throw new Error(
        "PLAN BLOCK: five distinct eligible recipient/course/type pairs required",
      );
    if (manifest) {
      if (
        manifest.actorId !== actorId ||
        manifest.action !== "DEMO_CERTIFICATES_PLANNED" ||
        manifest.metadata.seedOwner !== CERTIFICATE_DEMO_OWNER ||
        manifest.metadata.origin !== options.verificationOrigin
      )
        throw new Error("F9 provenance changed");
      fixtures = JSON.parse(String(manifest.metadata.fixtures));
      if (fingerprint(fixtures) !== manifest.metadata.fixturesHash)
        throw new Error("F9 fixture manifest changed");
    } else {
      for (const source of sources)
        if (
          (
            await tx
              .select()
              .from(s.certificates)
              .where(eq(s.certificates.courseId, source.course.id))
          ).length
        )
          throw new Error("Unowned certificate collision; no adoption");
    }
    const current = await tx
      .select({
        id: s.certificates.id,
        state: s.certificates.state,
        revision: s.certificates.revision,
      })
      .from(s.certificates);
    const [complete] = await tx
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, completeId));
    if (
      complete &&
      (complete.actorId !== actorId ||
        complete.metadata.seedOwner !== CERTIFICATE_DEMO_OWNER ||
        complete.action !== "DEMO_CERTIFICATES_COMPLETED")
    )
      throw new Error("F9 completion provenance changed");
    return {
      owner: CERTIFICATE_DEMO_OWNER,
      actorId,
      configuration: {
        present: !!settings,
        revision: settings?.revision ?? 0,
        effective: config,
      },
      fixtures,
      sourceHash: fingerprint(sources),
      current,
      existing: !!manifest,
      completed: !!complete,
      verificationOrigin: options.verificationOrigin,
      plannedCount:
        fixtures.length +
        fixtures.filter((f) => f.scenario === "replaced").length,
    };
  });
}

/** Explicit extension: no F8 replay, no app environment fallback, no fabricated certificate SQL. */
export async function runComprehensiveCertificates(
  db: RegistrationDatabase,
  options: CertificateDemoOptions,
) {
  const plan = await planCertificates(db, options);
  options.preview?.(plan);
  if (
    options.expectedPlanHash &&
    fingerprint(plan) !== options.expectedPlanHash
  )
    throw new Error("Reviewed certificate plan changed before writes");
  if (!options.apply || plan.completed) return plan;
  const identity = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, plan.actorId));
  const authActor = await options.auth.auth.admin.getUserById(
    identity[0]!.authUserId!,
  );
  if (
    authActor.error ||
    authActor.data.user?.app_metadata.seed_owner !== COMPREHENSIVE_DEMO_OWNER
  )
    throw new Error("Owned fixture Auth identity required");
  if (!plan.existing)
    await db.transaction(async (tx) => {
      await lockInstructorSchedules(tx);
      await tx.execute(sql`select pg_advisory_xact_lock(20260915, 9)`);
      await requireFreshRegistrationActor(tx, plan.actorId);
      const lockedSources = [];
      for (const groupId of new Set(
        plan.fixtures.map((f) => f.input.groupId),
      )) {
        const input = plan.fixtures.find(
          (f) => f.input.groupId === groupId,
        )!.input;
        const [course] = await tx
          .select()
          .from(s.courses)
          .where(eq(s.courses.id, input.courseId))
          .for("share");
        const [group] = await tx
          .select()
          .from(s.groups)
          .where(eq(s.groups.id, groupId))
          .for("share");
        const [state] = await tx
          .select()
          .from(s.academicGroupStates)
          .where(eq(s.academicGroupStates.groupId, groupId))
          .for("share");
        const [version] = await tx
          .select()
          .from(s.academicClosureVersions)
          .where(eq(s.academicClosureVersions.id, input.versionId));
        lockedSources.push({ state, version, course, group });
      }
      if (fingerprint(lockedSources) !== plan.sourceHash)
        throw new Error(
          "Certificate sources changed after PLAN; no writes committed",
        );
      const [present] = await tx
        .select()
        .from(s.certificateSettings)
        .where(eq(s.certificateSettings.id, 1));
      if (
        fingerprint(
          present?.configuration ?? demoCertificateConfiguration(),
        ) !== fingerprint(plan.configuration.effective) ||
        (present?.revision ?? 0) !== plan.configuration.revision ||
        !!present !== plan.configuration.present
      )
        throw new Error("Settings changed after PLAN");
      if (!present)
        await new DrizzleCertificateRepository(tx).updateSettings(
          plan.actorId,
          0,
          plan.configuration.effective,
        );
      await tx.insert(s.auditEvents).values({
        id: manifestId,
        actorId: plan.actorId,
        entityType: "DEMO",
        entityId: manifestId,
        action: "DEMO_CERTIFICATES_PLANNED",
        metadata: {
          seedOwner: CERTIFICATE_DEMO_OWNER,
          fixtures: JSON.stringify(plan.fixtures),
          fixturesHash: fingerprint(plan.fixtures),
          origin: options.verificationOrigin,
          notice: DEMO_CERTIFICATE_REASON,
        },
      });
    });
  const repository = new DrizzleCertificateRepository(db);
  const storage = new SupabaseCertificateStorage(options.auth);
  await storage.provision();
  const service = new ManageCertificates(
    repository,
    storage,
    createCertificatePdfRenderer(),
    options.verificationOrigin,
  );
  const command = (row: CertificateDto, key: string) => ({
    certificateId: row.id,
    revision: row.revision,
    requestKey: certificateDemoId(key),
  });
  async function issue(row: CertificateDto, key: string) {
    // Always consult current records, not stale receipt DTOs; never upload/re-render an issued artifact.
    row = await repository.get(plan.actorId, row.id);
    if (["issued", "revoked", "replaced"].includes(row.state)) return row;
    if (!row.hasSignedPdf)
      row = await service.uploadSigned(
        plan.actorId,
        command(row, `upload:${key}`),
        await stampDemoFinalPdf(
          await service.download(plan.actorId, row.id, "UNSIGNED"),
        ),
      );
    if (!row.reviewed)
      row = await repository.review(
        plan.actorId,
        command(row, `review:${key}`),
      );
    return repository.issue(plan.actorId, command(row, `issue:${key}`));
  }
  for (const fixture of plan.fixtures) {
    const [prepared] = await service.generate(plan.actorId, fixture.input);
    if (!prepared) throw new Error("Missing prepared fixture");
    let row = await repository.get(plan.actorId, prepared.id);
    if (fixture.scenario === "generated") continue;
    if (fixture.scenario === "awaiting_signature") {
      if (!row.hasSignedPdf)
        await service.uploadSigned(
          plan.actorId,
          command(row, `upload:${fixture.key}`),
          await stampDemoFinalPdf(
            await service.download(plan.actorId, row.id, "UNSIGNED"),
          ),
        );
      continue;
    }
    row = await issue(row, fixture.key);
    if (fixture.scenario === "revoked" && row.state === "issued")
      await repository.revoke(
        plan.actorId,
        command(row, `revoke:${fixture.key}`),
        DEMO_CERTIFICATE_REASON,
      );
    if (fixture.scenario === "replaced") {
      if (row.state === "replaced") continue;
      const [replacement] = await service.generate(plan.actorId, {
        ...fixture.input,
        requestKey: certificateDemoId(`replacement:${fixture.key}`),
        replacementForId: row.id,
        reason: DEMO_CERTIFICATE_REASON,
      });
      if (!replacement) throw new Error("Missing replacement fixture");
      await issue(replacement, `replacement:${fixture.key}`);
    }
  }
  await db.transaction(async (tx) => {
    await requireFreshRegistrationActor(tx, plan.actorId);
    await tx.insert(s.auditEvents).values({
      id: completeId,
      actorId: plan.actorId,
      entityType: "DEMO",
      entityId: completeId,
      action: "DEMO_CERTIFICATES_COMPLETED",
      metadata: {
        seedOwner: CERTIFICATE_DEMO_OWNER,
        notice: DEMO_CERTIFICATE_REASON,
      },
    });
  });
  return plan;
}
