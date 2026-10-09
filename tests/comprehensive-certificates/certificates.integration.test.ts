import { expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DrizzleCertificateRepository } from "@/server/db/repositories/certificate-repository";
import {
  SupabaseCertificateStorage,
  CERTIFICATE_BUCKET,
} from "@/server/certificates/storage";
import { defaultCertificateConfiguration } from "@/domain/certificates/rules";
import { certificateResources } from "@/server/certificates/pdf/resources";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { runComprehensiveDemo } from "../../scripts/comprehensive-demo";
import { runComprehensiveCertificates } from "../../scripts/comprehensive-demo-certificates";
import { DEMO_PDF_NOTICE } from "../../scripts/comprehensive-demo-certificates-plan";
import {
  captureDemoSnapshot,
  assertDemoPreservation,
  assertDemoNoChanges,
  demoSnapshotSummary,
} from "../../scripts/comprehensive-demo-preservation";
import { fingerprint } from "../../scripts/financial-demo-plan";

test("F9 opt-in uses real lifecycle/renderer/private Storage, preserves F8 and all original full rows; repeat has zero changes", async () => {
  const env = getTestSupabaseEnvironment();
  const connection = createDatabase(env.databaseUrl, { max: 1 });
  const auth = createClient(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const db = connection.db;
    const identity = await auth.auth.admin.createUser({
      email: "certificate.demo.original@example.test",
      password: "QA-only-Fixture-password-123!",
      email_confirm: true,
    });
    if (identity.error) throw identity.error;
    const [original] = await db
      .insert(s.users)
      .values({
        email: identity.data.user.email!,
        name: "Original fictitious QA operator",
        status: "ACTIVE",
        authPrimaryProvider: "EMAIL",
        authUserId: identity.data.user.id,
      })
      .returning();
    await db
      .insert(s.userRoles)
      .values({ userId: original!.id, roleCode: "ADMIN" });
    const context = await runComprehensiveDemo(db, {
      actorId: original!.id,
      auth,
      password: "QA-only-Fixture-password-123!",
      apply: true,
    });
    expect(context).not.toBeNull();
    const repo = new DrizzleCertificateRepository(db);
    const defaults = await repo.getSettings(original!.id);
    expect(defaults).toEqual({
      revision: 0,
      configuration: defaultCertificateConfiguration,
    });
    expect(await db.select().from(s.certificateSettings)).toHaveLength(0);
    const storage = new SupabaseCertificateStorage(auth);
    const oldPath = `${crypto.randomUUID()}/unsigned/${crypto.randomUUID()}.pdf`;
    const pdf = await PDFDocument.create();
    pdf.addPage();
    await storage.provision();
    await storage.put(oldPath, await pdf.save());
    const logoHashes = (await certificateResources()).logos.map((bytes) =>
      createHash("sha256").update(bytes).digest("hex"),
    );
    const before = await captureDemoSnapshot(db);
    expect(before.ledger).toHaveLength(24);
    const options = {
      actorId: original!.id,
      auth,
      apply: false,
      verificationOrigin: "https://demo.invalid",
    };
    const plan = await runComprehensiveCertificates(db, options);
    expect(plan.configuration.present).toBe(false);
    expect(plan.fixtures.map((f) => f.scenario)).toEqual(
      expect.arrayContaining([
        "generated",
        "awaiting_signature",
        "issued",
        "revoked",
        "replaced",
      ]),
    );
    expect(
      plan.fixtures.filter((f) => f.input.type === "INSTRUCTOR"),
    ).toHaveLength(2);
    expect(
      plan.fixtures
        .filter((f) => f.input.courseId === context!.courses.reclosed!.courseId)
        .every((f) => f.input.closureRevision === 3),
    ).toBe(true);
    assertDemoNoChanges(before, await captureDemoSnapshot(db));
    await expect(
      runComprehensiveCertificates(db, {
        ...options,
        apply: true,
        expectedPlanHash: "0".repeat(64),
      }),
    ).rejects.toThrow("Reviewed certificate plan changed");
    assertDemoNoChanges(before, await captureDemoSnapshot(db));
    // Inject only a lost response AFTER the real issue committed. A retry must
    // use current records/receipts, not re-render or upload this issued PDF.
    const actualIssue = DrizzleCertificateRepository.prototype.issue;
    const lostAcknowledgment = spyOn(
      DrizzleCertificateRepository.prototype,
      "issue",
    ).mockImplementation(async (actorId, command) => {
      await actualIssue.call(repo, actorId, command);
      throw new Error("Synthetic lost issue acknowledgment");
    });
    try {
      await expect(
        runComprehensiveCertificates(db, {
          ...options,
          apply: true,
          expectedPlanHash: fingerprint(plan),
        }),
      ).rejects.toThrow("Synthetic lost issue acknowledgment");
    } finally {
      lostAcknowledgment.mockRestore();
    }
    assertDemoPreservation(before, await captureDemoSnapshot(db));
    const partial = await db.select().from(s.certificates);
    const committed = partial.find((row) => row.state === "issued");
    expect(committed).toBeDefined();
    const committedBytes = await storage.get(committed!.signedPath!);
    await runComprehensiveCertificates(db, { ...options, apply: true });
    expect(await storage.get(committed!.signedPath!)).toEqual(committedBytes);
    const first = await captureDemoSnapshot(db);
    assertDemoPreservation(before, first);
    const certificates = await db.select().from(s.certificates);
    expect(certificates).toHaveLength(plan.plannedCount);
    expect(new Set(certificates.map((r) => r.state))).toEqual(
      new Set([
        "generated",
        "awaiting_signature",
        "issued",
        "revoked",
        "replaced",
      ]),
    );
    const settings = await db.select().from(s.certificateSettings);
    expect(settings[0]!.updatedBy).toBe(context!.admins.operator!);
    expect(settings[0]!.revision).toBe(1);
    for (const row of certificates) {
      expect(row.createdBy).toBe(context!.admins.operator!);
      expect(row.data.courseName).toContain("[DEMO]");
      expect(row.data.recipientName.toLowerCase()).toContain("demo");
      expect(row.data.templateVersion).toBe("phase9-v1");
      expect(row.data.venue).toBe(defaultCertificateConfiguration.venue);
      expect(row.data.printedMonth).toBe(Number(row.data.endsOn.slice(5, 7)));
      expect(row.data.printedYear).toBe(Number(row.data.endsOn.slice(0, 4)));
      const unsigned = await PDFDocument.load(
        await storage.get(row.unsignedPath!),
      );
      expect(unsigned.getPage(0).getSize()).toEqual(
        row.type === "APPROVAL"
          ? { width: 792, height: 612 }
          : { width: 612, height: 792 },
      );
      const publicDto = await repo.verify(row.publicCredentialId);
      expect(publicDto).not.toHaveProperty("signedPath");
      expect(publicDto).not.toHaveProperty("data");
      expect(publicDto).not.toHaveProperty("demoFlag");
      if (["generated", "awaiting_signature"].includes(row.state))
        expect(publicDto).toEqual({ state: "not_issued", valid: false });
      else
        expect(publicDto).toMatchObject({
          state: row.state,
          valid: row.state === "issued",
          courseName: row.data.courseName,
          signedSha256: row.signedSha256,
        });
      if (row.signedPath) {
        const bytes = await storage.get(row.signedPath);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          row.signedSha256!,
        );
        expect((await PDFDocument.load(bytes)).getTitle()).toBe(
          DEMO_PDF_NOTICE,
        );
        const anonymous = createClient(env.apiUrl, env.publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        expect(
          (
            await anonymous.storage
              .from(CERTIFICATE_BUCKET)
              .download(row.signedPath)
          ).error,
        ).not.toBeNull();
        expect(
          (
            await fetch(
              `${env.apiUrl}/storage/v1/object/public/${CERTIFICATE_BUCKET}/${row.signedPath}`,
            )
          ).ok,
        ).toBe(false);
      }
      if (row.state === "replaced") {
        const replacement = certificates.find(
          (r) => r.id === row.replacedById,
        )!;
        expect(replacement.state).toBe("issued");
        expect(replacement.replacementForId).toBe(row.id);
        expect(replacement.recipientId).toBe(row.recipientId);
      }
    }
    await runComprehensiveCertificates(db, { ...options, apply: true });
    const repeat = await captureDemoSnapshot(db);
    assertDemoPreservation(before, repeat);
    assertDemoNoChanges(first, repeat);
    expect(
      (await certificateResources()).logos.map((bytes) =>
        createHash("sha256").update(bytes).digest("hex"),
      ),
    ).toEqual(logoHashes);
    expect(await storage.get(oldPath)).toEqual(
      new Uint8Array(await pdf.save()),
    );
    console.info(
      JSON.stringify({
        project: process.env.TEST_SUPABASE_PROJECT_ID,
        baseline: demoSnapshotSummary(before),
        after: demoSnapshotSummary(repeat),
        certificates: certificates.length,
        states: Object.fromEntries(
          [
            "generated",
            "awaiting_signature",
            "issued",
            "revoked",
            "replaced",
          ].map((state) => [
            state,
            certificates.filter((r) => r.state === state).length,
          ]),
        ),
        repeatedChanges: 0,
      }),
    );
    // A subsequently customized complete config is preserved, not reset to demo defaults.
    await repo.updateSettings(context!.admins.operator!, 1, {
      ...settings[0]!.configuration,
      city: "[DEMO] Ciudad personalizada",
    });
    const customized = await captureDemoSnapshot(db);
    await runComprehensiveCertificates(db, { ...options, apply: true });
    assertDemoNoChanges(customized, await captureDemoSnapshot(db));
    // An incomplete existing config blocks and is never repaired by demo.
    await repo.updateSettings(context!.admins.operator!, 2, {
      ...settings[0]!.configuration,
      director: { ...settings[0]!.configuration.director, name: "" },
    });
    const custom = await captureDemoSnapshot(db);
    await expect(
      runComprehensiveCertificates(db, { ...options, apply: true }),
    ).rejects.toThrow();
    assertDemoNoChanges(custom, await captureDemoSnapshot(db));
  } finally {
    await connection.close();
  }
}, 120000);
