import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";
import {
  SupabaseCertificateStorage,
  CERTIFICATE_BUCKET,
} from "@/server/certificates/storage";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DrizzleCertificateRepository } from "@/server/db/repositories/certificate-repository";
import { DrizzleClosureRepository } from "@/server/db/repositories/academic-closure-repository";
import { DrizzleEvaluationRepository } from "@/server/db/repositories/evaluation-repository";
import { hasAdminActorActivity } from "@/server/db/repositories/admin-account-dependencies";
import { ManageCertificates } from "@/application/certificates/manage-certificates";
import { createCertificatePdfRenderer } from "@/server/certificates/renderer";
import type { CertificateStorage } from "@/application/certificates/types";
import type { ArtifactReservation } from "@/application/certificates/repository";
import { defaultCertificateConfiguration } from "@/domain/certificates/rules";
import {
  handleCertificatePost,
  handleCertificateUpload,
} from "@/server/certificates/http";
import type { CertificateDto } from "@/domain/certificates/types";
import { createClosureFixture } from "../fixtures/academic-closure";
import { evaluationFixtureTables } from "../fixtures/evaluation-cleanup";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

const connection = createDatabase(getTestSupabaseEnvironment().databaseUrl, {
  max: 8,
});
const db = connection.db;
console.info(
  "F9 isolated QA",
  process.env.TEST_SUPABASE_PROJECT_ID,
  "DB port",
  new URL(getTestSupabaseEnvironment().databaseUrl).port,
  "API port",
  new URL(getTestSupabaseEnvironment().apiUrl).port,
);
let now = new Date("2099-02-01T12:00:00Z");
const clock = () => now;
const repository = new DrizzleCertificateRepository(db, clock);
const closure = new DrizzleClosureRepository(db, clock);
const evaluations = new DrizzleEvaluationRepository(db, clock);
class MemoryStorage implements CertificateStorage {
  objects = new Map<string, Uint8Array>();
  failPut = false;
  failRemove = false;
  afterPut: (() => Promise<void>) | undefined;
  async put(path: string, bytes: Uint8Array) {
    if (this.failPut) throw new Error("Synthetic Storage failure");
    if (this.objects.has(path)) throw new Error("Immutable object exists");
    this.objects.set(path, bytes.slice());
    await this.afterPut?.();
  }
  async get(path: string) {
    const bytes = this.objects.get(path);
    if (!bytes) throw new Error("Missing object");
    return bytes.slice();
  }
  async remove(path: string) {
    if (this.failRemove) throw new Error("Synthetic cleanup failure");
    this.objects.delete(path);
  }
}
const pdf = await PDFDocument.create();
pdf.addPage();
const unsigned = await pdf.save();
pdf.setTitle("Synthetic signed scan");
const signed = await pdf.save();
afterAll(async () => {
  await db.execute(
    sql`truncate ${evaluationFixtureTables}, participant_attendance, instructor_attendance, session_roster, attendance_command_receipts, group_sessions, registration_ledger, registration_command_receipts, pre_registrations, participants restrict`,
  );
  await connection.close();
});
async function setup(score = "100") {
  now = new Date("2099-02-01T12:00:00Z");
  const f = await createClosureFixture(db, clock);
  await evaluations.saveScheme(f.admin.id, {
    courseId: f.course.id,
    requestKey: crypto.randomUUID(),
    schemeRevision: 0,
    components: f.components,
  });
  now = new Date("2099-03-06T12:00:00Z");
  const groupId = f.groups[0]!.id;
  await evaluations.saveRow(f.admin.id, {
    courseId: f.course.id,
    groupId,
    registrationId: f.paid.id,
    requestKey: crypto.randomUUID(),
    schemeRevision: 1,
    grades: [{ componentId: f.components[0]!.id, gradeRevision: 0, score }],
  });
  for (const session of f.calendar.sessions)
    await f.attendance.record(f.admin.id, {
      courseId: f.course.id,
      groupId,
      sessionId: session.id,
      revision: session.revision,
      requestKey: crypto.randomUUID(),
      marks: [{ registrationId: f.paid.id, status: "PRESENT" }],
      instructorStatus: "PRESENT",
    });
  const version = await closure.close(f.admin.id, {
    courseId: f.course.id,
    groupId,
    requestKey: crypto.randomUUID(),
    revision: 0,
  });
  const config = structuredClone(defaultCertificateConfiguration);
  config.director = { ...config.director, name: "Fictitious Director" };
  config.dean = { ...config.dean, name: "Fictitious Dean" };
  config.departmentHead = {
    ...config.departmentHead,
    name: "Fictitious Department Head",
  };
  const settings = await repository.getSettings(f.admin.id);
  const updatedSettings = await repository.updateSettings(
    f.admin.id,
    settings.revision,
    config,
  );
  const storage = new MemoryStorage();
  const service = new ManageCertificates(
    repository,
    storage,
    { render: async () => unsigned },
    "https://qa.invalid",
  );
  const input = {
    courseId: f.course.id,
    groupId,
    versionId: version.versionId,
    closureRevision: version.revision,
    configurationRevision: updatedSettings.revision,
    requestKey: crypto.randomUUID(),
    type: "APPROVAL" as const,
    recipientId: null,
  };
  return { ...f, groupId, version, input, storage, service };
}
function command(row: CertificateDto) {
  return {
    certificateId: row.id,
    revision: row.revision,
    requestKey: crypto.randomUUID(),
  };
}
async function ready(
  f: Awaited<ReturnType<typeof setup>>,
  row: CertificateDto,
) {
  const uploaded = await f.service.uploadSigned(
    f.admin.id,
    command(row),
    signed,
  );
  return repository.review(f.admin.id, command(uploaded));
}

test("F9 generation freezes F8 identity and nominal metadata; public drafts are minimal and instructor ownership is historical", async () => {
  const f = await setup();
  const original = await closure.getVersion(
    f.admin.id,
    f.course.id,
    f.groupId,
    1,
  );
  const [row] = await f.service.generate(f.admin.id, f.input);
  expect(row).toBeDefined();
  expect(row!).toMatchObject({
    state: "generated",
    version: 1,
    data: {
      courseName: original.report.courseName,
      academicHours: 6,
      recipientName: `${original.report.participants[0]!.firstName} ${original.report.participants[0]!.lastName}`,
      instructorName: original.report.instructorName,
      endsOn: "2099-03-05",
      printedMonth: 3,
      printedYear: 2099,
      city: "Cochabamba",
    },
  });
  expect(await repository.verify(row!.publicCredentialId)).toEqual({
    state: "not_issued",
    valid: false,
  });
  expect(await repository.verify("000")).toEqual({
    state: "not_found",
    valid: false,
  });
  expect(await f.service.generate(f.admin.id, f.input)).toEqual([row!]);
  await expect(
    f.service.generate(f.admin.id, { ...f.input, type: "INSTRUCTOR" }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await db
    .update(s.participants)
    .set({ firstName: "Changed live name" })
    .where(
      eq(s.participants.id, original.report.participants[0]!.participantId),
    );
  await db
    .update(s.courses)
    .set({ name: "Changed live course", instructorId: f.foreign.id })
    .where(eq(s.courses.id, f.course.id));
  expect((await repository.get(f.instructor.id, row!.id)).data).toEqual(
    row!.data,
  );
  await expect(repository.get(f.foreign.id, row!.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    await f.service.download(f.instructor.id, row!.id, "UNSIGNED"),
  ).toEqual(unsigned);
  await expect(
    f.service.download(f.foreign.id, row!.id, "UNSIGNED"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    (await closure.getVersion(f.admin.id, f.course.id, f.groupId, 1)).report,
  ).toEqual(original.report);
}, 30000);
test("official failed/zero grades never yield APPROVAL while instructor remains eligible", async () => {
  const f = await setup("0");
  await expect(f.service.generate(f.admin.id, f.input)).rejects.toMatchObject({
    code: "NOT_ELIGIBLE",
  });
  const [row] = await f.service.generate(f.admin.id, {
    ...f.input,
    type: "INSTRUCTOR",
    requestKey: crypto.randomUUID(),
  });
  expect(row!.data.recipientName).toBe(
    (await closure.getVersion(f.admin.id, f.course.id, f.groupId, 1)).report
      .instructorName!,
  );
  expect(row!.type).toBe("INSTRUCTOR");
}, 30000);
test("issue requires reviewed exact signed PDF, is idempotent and serializes concurrent issue/revoke", async () => {
  const f = await setup();
  const [generated] = await f.service.generate(f.admin.id, f.input);
  await expect(
    repository.issue(f.admin.id, command(generated!)),
  ).rejects.toMatchObject({ code: "INVALID_STATE" });
  const uploadCommand = command(generated!);
  const uploaded = await f.service.uploadSigned(
    f.admin.id,
    uploadCommand,
    signed,
  );
  expect(
    await f.service.uploadSigned(f.admin.id, uploadCommand, signed),
  ).toEqual(uploaded);
  await expect(
    f.service.uploadSigned(f.admin.id, uploadCommand, unsigned),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    repository.issue(f.admin.id, command(uploaded)),
  ).rejects.toMatchObject({ code: "INVALID_STATE" });
  const reviewed = await repository.review(f.admin.id, command(uploaded));
  const c = command(reviewed);
  const results = await Promise.all([
    repository.issue(f.admin.id, c),
    repository.issue(f.admin.id, c),
  ]);
  expect(results[0]).toEqual(results[1]);
  const issued = results[0]!;
  expect(issued.state).toBe("issued");
  expect(issued.signedSha256).toBe(
    createHash("sha256").update(signed).digest("hex"),
  );
  expect(
    await f.service.download(f.instructor.id, issued.id, "SIGNED"),
  ).toEqual(signed);
  expect((await repository.verify(issued.publicCredentialId)).valid).toBe(true);
  await expect(
    f.service.uploadSigned(f.admin.id, command(issued), signed),
  ).rejects.toMatchObject({ code: "INVALID_STATE" });
  const revoke = command(issued);
  const revoked = await repository.revoke(
    f.admin.id,
    revoke,
    "Synthetic correction",
  );
  expect(
    await repository.revoke(f.admin.id, revoke, "Synthetic correction"),
  ).toEqual(revoked);
  expect(await repository.verify(issued.publicCredentialId)).toMatchObject({
    state: "revoked",
    valid: false,
    signedSha256: issued.signedSha256,
  });
  expect(
    (await repository.history(f.admin2.id, issued.id)).at(-1),
  ).toMatchObject({
    action: "REVOKE",
    actorId: f.admin.id,
    actorName: f.admin.name,
    reason: "Synthetic correction",
  });
  await expect(
    repository.history(f.instructor.id, issued.id),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    db.delete(s.certificates).where(eq(s.certificates.id, issued.id)).execute(),
  ).rejects.toThrow();
  await expect(
    db
      .update(s.certificates)
      .set({ signedSha256: "b".repeat(64), revision: revoked.revision + 1 })
      .where(eq(s.certificates.id, issued.id))
      .execute(),
  ).rejects.toThrow();
}, 30000);
test("reopening retains issued validity but obsoletes drafts; new closure cannot issue old draft", async () => {
  const f = await setup();
  const [generated] = await f.service.generate(f.admin.id, f.input);
  const reviewed = await ready(f, generated!);
  const issued = await repository.issue(f.admin.id, command(reviewed));
  const [draft] = await f.service.generate(f.admin.id, {
    ...f.input,
    type: "INSTRUCTOR",
    requestKey: crypto.randomUUID(),
  });
  await closure.reopen(f.admin.id, {
    courseId: f.course.id,
    groupId: f.groupId,
    revision: 1,
    requestKey: crypto.randomUUID(),
    reason: "Synthetic reopening",
  });
  expect((await repository.get(f.admin.id, draft!.id)).obsolete).toBe(true);
  expect((await repository.verify(issued.publicCredentialId)).valid).toBe(true);
  await expect(
    f.service.uploadSigned(f.admin.id, command(draft!), signed),
  ).rejects.toMatchObject({ code: "STALE_CLOSURE" });
  const next = await closure.close(f.admin.id, {
    courseId: f.course.id,
    groupId: f.groupId,
    revision: 2,
    requestKey: crypto.randomUUID(),
  });
  expect(next.version).toBe(2);
  await expect(
    repository.prepare(
      f.admin.id,
      { ...f.input, requestKey: crypto.randomUUID() },
      "https://qa.invalid",
    ),
  ).rejects.toMatchObject({ code: "STALE_CLOSURE" });
  await expect(
    repository.issue(f.admin.id, command(draft!)),
  ).rejects.toMatchObject({ code: "STALE_CLOSURE" });
}, 30000);
test("replacement atomically links history and prevents two equivalent active certificates", async () => {
  const f = await setup();
  const [generated] = await f.service.generate(f.admin.id, f.input);
  const originalReady = await ready(f, generated!);
  const issued = await repository.issue(f.admin.id, command(originalReady));
  await expect(
    f.service.generate(f.admin.id, {
      ...f.input,
      requestKey: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "ACTIVE_CERTIFICATE_EXISTS" });
  const official = await closure.getVersion(
    f.admin.id,
    f.course.id,
    f.groupId,
    1,
  );
  const replacementInput = {
    ...f.input,
    recipientId: official.report.participants[0]!.participantId,
    replacementForId: issued.id,
    reason: "Synthetic replacement",
    requestKey: crypto.randomUUID(),
  };
  const [one] = await f.service.generate(f.admin.id, replacementInput);
  const [two] = await f.service.generate(f.admin.id, {
    ...replacementInput,
    requestKey: crypto.randomUUID(),
  });
  const a = await ready(f, one!),
    b = await ready(f, two!);
  const results = await Promise.allSettled([
    repository.issue(f.admin.id, command(a)),
    repository.issue(f.admin2.id, command(b)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const winner = results.find((r) => r.status === "fulfilled");
  if (winner?.status !== "fulfilled") throw new Error("No replacement winner");
  expect(await repository.get(f.admin.id, issued.id)).toMatchObject({
    state: "replaced",
    replacedById: winner.value.id,
  });
  expect(winner.value.replacementForId).toBe(issued.id);
  expect((await repository.verify(issued.publicCredentialId)).valid).toBe(
    false,
  );
  expect((await repository.verify(winner.value.publicCredentialId)).valid).toBe(
    true,
  );
  expect(
    (await repository.list(f.admin.id, f.course.id, f.groupId)).filter(
      (r) => r.state === "issued",
    ),
  ).toHaveLength(1);
}, 30000);
test("fresh roles/status and F9 used-account references are enforced", async () => {
  const f = await setup();
  const [row] = await f.service.generate(f.admin.id, f.input);
  expect(
    await db.transaction((tx) => hasAdminActorActivity(tx, f.admin.id)),
  ).toBe(true);
  await expect(
    repository.review(f.instructor.id, command(row!)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db
    .update(s.users)
    .set({ status: "DISABLED" })
    .where(eq(s.users.id, f.admin.id));
  await expect(repository.get(f.admin.id, row!.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await db
    .update(s.users)
    .set({ status: "ACTIVE" })
    .where(eq(s.users.id, f.admin.id));
  await db
    .delete(s.userRoles)
    .where(
      sql`${s.userRoles.userId} = ${f.admin.id} and ${s.userRoles.roleCode} = 'ADMIN'`,
    );
  await expect(
    repository.issue(f.admin.id, command(row!)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
}, 30000);
test("Storage failure and stale attach compensate only new object and leave durable cleanup outbox", async () => {
  const f = await setup();
  const [row] = await f.service.generate(f.admin.id, f.input);
  const originalPaths = [...f.storage.objects.keys()];
  f.storage.afterPut = async () => {
    await closure.reopen(f.admin.id, {
      courseId: f.course.id,
      groupId: f.groupId,
      revision: 1,
      requestKey: crypto.randomUUID(),
      reason: "Synthetic racing reopen",
    });
  };
  f.storage.failRemove = true;
  await expect(
    f.service.uploadSigned(f.admin.id, command(row!), signed),
  ).rejects.toMatchObject({ code: "STALE_CLOSURE" });
  const artifacts = await db
    .select()
    .from(s.certificateArtifacts)
    .where(eq(s.certificateArtifacts.certificateId, row!.id));
  expect(artifacts.map((a) => a.status).sort()).toEqual([
    "attached",
    "cleanup_pending",
  ]);
  expect(f.storage.objects.size).toBe(2);
  f.storage.failRemove = false;
  f.storage.afterPut = undefined;
  await f.service.cleanup(
    f.admin.id,
    new Date(Date.now() - 2 * 60 * 60 * 1000),
  );
  expect([...f.storage.objects.keys()]).toEqual(originalPaths);
  expect((await repository.get(f.admin.id, row!.id)).hasSignedPdf).toBe(false);
}, 30000);
test("HTTP mutation and upload adapters validate origin, allowlist, purpose and malformed content", async () => {
  const f = await setup();
  const actor = { ...f.admin, roles: ["ADMIN" as const] };
  const [row] = await f.service.generate(f.admin.id, f.input);
  const siteUrl = new URL("https://qa.invalid");
  const request = (body: object, origin = siteUrl.origin) =>
    new Request(`${siteUrl}action`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (
      await handleCertificatePost({
        request: request(command(row!), "https://foreign.invalid"),
        actor,
        siteUrl,
        repository,
        operation: "issue",
        certificateId: row!.id,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await handleCertificatePost({
        request: request({ ...command(row!), actorId: f.admin.id }),
        actor,
        siteUrl,
        repository,
        operation: "issue",
        certificateId: row!.id,
      })
    ).status,
  ).toBe(422);
  const form = new FormData();
  form.set(
    "file",
    new File(["not a PDF"], "scan.pdf", { type: "application/pdf" }),
  );
  form.set("purpose", "SIGNED");
  form.set("revision", String(row!.revision));
  form.set("requestKey", crypto.randomUUID());
  const result = await handleCertificateUpload({
    request: new Request(`${siteUrl}upload`, {
      method: "POST",
      headers: { Origin: siteUrl.origin },
      body: form,
    }),
    actor,
    siteUrl,
    certificateId: row!.id,
    service: f.service,
  });
  expect(result.status).toBe(422);
  expect((await repository.get(f.admin.id, row!.id)).hasSignedPdf).toBe(false);
}, 30000);
test("F9 tables are server-only with RLS and revoked Data API grants; ledger is 24", async () => {
  const tables = [
    "certificates",
    "certificate_artifacts",
    "certificate_events",
    "certificate_receipts",
    "certificate_settings",
  ];
  for (const name of tables) {
    const result = await db.execute(
      sql`select relrowsecurity as rls from pg_class where oid = ${`public.${name}`}::regclass`,
    );
    expect(result[0]!.rls).toBe(true);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const grants = await db.execute(
        sql`select has_table_privilege(${role},${`public.${name}`},'SELECT,INSERT,UPDATE,DELETE') as allowed`,
      );
      expect(grants[0]!.allowed).toBe(false);
    }
  }
  const ledger = await db.execute(
    sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
  );
  expect(ledger[0]!.count).toBe(24);
});
test("failed Storage upload preserves original unsigned file and completes scoped compensation", async () => {
  const f = await setup();
  const [row] = await f.service.generate(f.admin.id, f.input);
  const before = [...f.storage.objects.keys()];
  f.storage.failPut = true;
  await expect(
    f.service.uploadSigned(f.admin.id, command(row!), signed),
  ).rejects.toThrow("Synthetic Storage failure");
  expect([...f.storage.objects.keys()]).toEqual(before);
  expect((await repository.get(f.admin.id, row!.id)).hasSignedPdf).toBe(false);
  const artifacts = await db
    .select()
    .from(s.certificateArtifacts)
    .where(eq(s.certificateArtifacts.certificateId, row!.id));
  expect(artifacts.map((a) => a.status).sort()).toEqual([
    "attached",
    "cleaned",
  ]);
}, 30000);
test("ambiguous attach acknowledgment never compensates an already committed artifact", async () => {
  const f = await setup();
  const [row] = await f.service.generate(f.admin.id, f.input);
  class LostAcknowledgmentRepository extends DrizzleCertificateRepository {
    override async attachArtifact(
      actorId: string,
      reservation: ArtifactReservation,
    ): Promise<CertificateDto> {
      await super.attachArtifact(actorId, reservation);
      throw new Error("Synthetic lost post-commit acknowledgment");
    }
  }
  const faultRepository = new LostAcknowledgmentRepository(db, clock);
  const service = new ManageCertificates(
    faultRepository,
    f.storage,
    { render: async () => unsigned },
    "https://qa.invalid",
  );
  const upload = command(row!);
  await expect(
    service.uploadSigned(f.admin.id, upload, signed),
  ).rejects.toThrow("Synthetic lost post-commit acknowledgment");
  expect(f.storage.objects.size).toBe(2);
  const committed = await repository.get(f.admin.id, row!.id);
  expect(committed.hasSignedPdf).toBe(true);
  expect(await f.service.download(f.admin.id, row!.id, "SIGNED")).toEqual(
    signed,
  );
  expect(await service.uploadSigned(f.admin.id, upload, signed)).toEqual(
    committed,
  );
}, 30000);
test("concurrent identical upload cannot abandon or delete the winning reservation", async () => {
  const f = await setup();
  const [row] = await f.service.generate(f.admin.id, f.input);
  let release!: () => void;
  let notify!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    notify = resolve;
  });
  f.storage.afterPut = async () => {
    notify();
    await waiting;
  };
  const upload = command(row!);
  const first = f.service.uploadSigned(f.admin.id, upload, signed);
  await started;
  try {
    await expect(
      f.service.uploadSigned(f.admin.id, upload, signed),
    ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
  } finally {
    release();
  }
  const winner = await first;
  expect(winner.hasSignedPdf).toBe(true);
  expect(f.storage.objects.size).toBe(2);
  expect(await f.service.uploadSigned(f.admin.id, upload, signed)).toEqual(
    winner,
  );
}, 30000);
test("stale configuration and recipient/version boundaries roll back generation without creating partial drafts", async () => {
  const f = await setup();
  for (const input of [
    { ...f.input, configurationRevision: f.input.configurationRevision - 1 },
    { ...f.input, recipientId: crypto.randomUUID() },
    { ...f.input, versionId: crypto.randomUUID() },
    { ...f.input, groupId: f.groups[1]!.id },
    { ...f.input, groupNumber: 0 },
  ])
    await expect(
      repository.prepare(
        f.admin.id,
        { ...input, requestKey: crypto.randomUUID() },
        "https://qa.invalid",
      ),
    ).rejects.toThrow();
  expect(
    await repository.list(f.admin.id, f.course.id, f.groupId),
  ).toHaveLength(0);
  const [row] = await f.service.generate(f.admin.id, f.input);
  const first = await f.service.uploadSigned(f.admin.id, command(row!), signed);
  const reviewed = await repository.review(f.admin.id, command(first));
  await expect(
    f.service.uploadSigned(f.admin.id, command(first), unsigned),
  ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
  const second = await f.service.uploadSigned(
    f.admin.id,
    command(reviewed),
    unsigned,
  );
  expect(second.reviewed).toBe(false);
  expect(f.storage.objects.size).toBe(3);
  await expect(
    repository.issue(f.admin.id, command(second)),
  ).rejects.toMatchObject({ code: "INVALID_STATE" });
}, 30000);
test("real isolated Storage bucket is private, immutable by upload, and never anonymously downloadable", async () => {
  const env = getTestSupabaseEnvironment();
  const client = createClient(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const storage = new SupabaseCertificateStorage(client);
  expect(
    (await client.storage.getBucket(CERTIFICATE_BUCKET)).data?.public,
  ).toBe(false);
  await storage.provision();
  const path = `${crypto.randomUUID()}/signed/${crypto.randomUUID()}.pdf`;
  try {
    await storage.put(path, signed);
    expect(await storage.get(path)).toEqual(new Uint8Array(signed));
    await expect(storage.put(path, unsigned)).rejects.toThrow();
    expect(await storage.get(path)).toEqual(new Uint8Array(signed));
    const anonymous = createClient(env.apiUrl, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(
      (await anonymous.storage.from(CERTIFICATE_BUCKET).download(path)).error,
    ).not.toBeNull();
    const publicResponse = await fetch(
      `${env.apiUrl}/storage/v1/object/public/${CERTIFICATE_BUCKET}/${path}`,
    );
    expect(publicResponse.ok).toBe(false);
    expect(
      (await client.storage.getBucket(CERTIFICATE_BUCKET)).data?.public,
    ).toBe(false);
  } finally {
    await storage.remove(path);
  }
}, 30000);
test("merged real renderer integrates with pending metadata and preserves separate authoritative signed scan hash", async () => {
  const f = await setup();
  const service = new ManageCertificates(
    repository,
    f.storage,
    createCertificatePdfRenderer(),
    "https://qa.invalid",
  );
  const [generated] = await service.generate(f.admin.id, f.input);
  const unsignedBytes = await service.download(
    f.admin.id,
    generated!.id,
    "UNSIGNED",
  );
  const document = await PDFDocument.load(unsignedBytes);
  expect(document.getPageCount()).toBe(1);
  expect(document.getCreationDate()?.toISOString()).toBe(
    generated!.data.generatedAt,
  );
  expect(generated!.signedSha256).toBeNull();
  const uploaded = await service.uploadSigned(
    f.admin.id,
    command(generated!),
    signed,
  );
  const reviewed = await repository.review(f.admin.id, command(uploaded));
  const issued = await repository.issue(f.admin.id, command(reviewed));
  expect(issued.signedSha256).toBe(
    createHash("sha256").update(signed).digest("hex"),
  );
  expect(issued.signedSha256).not.toBe(
    createHash("sha256").update(unsignedBytes).digest("hex"),
  );
}, 30000);
