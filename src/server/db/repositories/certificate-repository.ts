import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type {
  CertificateRepository,
  ArtifactReservation,
} from "@/application/certificates/repository";
import type {
  CertificateCommand,
  CertificateConfiguration,
  CertificateDto,
  GenerateCertificatesInput,
} from "@/domain/certificates/types";
import {
  certificateId,
  certificateRecipients,
  certificateText,
  CertificateError,
  defaultCertificateConfiguration,
  publicCertificate,
  requireCurrentClosure,
  validateCertificateConfiguration,
} from "@/domain/certificates/rules";
import { freezeCertificateData } from "@/domain/certificates/metadata";
import type {
  AttendanceDatabase,
  AttendanceTransaction,
} from "./attendance-calendar";
import {
  certificateActor,
  certificateGroup,
  currentCertificate,
} from "./certificate-context";

type Row = typeof s.certificates.$inferSelect;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function revision(actual: number, expected: number) {
  if (!Number.isSafeInteger(expected) || actual !== expected)
    throw new CertificateError(
      "CONCURRENT_UPDATE",
      "Los datos cambiaron. Recarga antes de continuar.",
    );
}
function commandValid(command: CertificateCommand) {
  certificateId(command.certificateId);
  certificateId(command.requestKey);
}
async function event(
  tx: AttendanceTransaction,
  actor: typeof s.users.$inferSelect,
  row: Row,
  action: string,
  reason?: string,
) {
  await tx.insert(s.certificateEvents).values({
    certificateId: row.id,
    actorId: actor.id,
    actorName: actor.name,
    action,
    reason,
  });
  await tx.insert(s.auditEvents).values({
    entityType: "CERTIFICATE",
    entityId: row.id,
    actorId: actor.id,
    action: `CERTIFICATE_${action}`,
    metadata: { ...(reason ? { reason } : {}), versionId: row.versionId },
  });
}
async function rowById(tx: AttendanceTransaction, id: string) {
  certificateId(id);
  const [row] = await tx
    .select()
    .from(s.certificates)
    .where(eq(s.certificates.id, id))
    .for("update");
  if (!row)
    throw new CertificateError("NOT_FOUND", "Certificado no disponible.");
  return row;
}
async function dto(tx: AttendanceTransaction, r: Row): Promise<CertificateDto> {
  const [state] = await tx
    .select()
    .from(s.academicGroupStates)
    .where(eq(s.academicGroupStates.groupId, r.groupId));
  return {
    id: r.id,
    courseId: r.courseId,
    groupId: r.groupId,
    versionId: r.versionId,
    version: r.version,
    type: r.type,
    state: r.state,
    revision: r.revision,
    publicCredentialId: r.publicCredentialId,
    data: r.data,
    obsolete: !state?.closed || state.lastVersion !== r.version,
    hasUnsignedPdf: Boolean(r.unsignedPath),
    hasSignedPdf: Boolean(r.signedPath),
    signedSha256: r.signedSha256,
    reviewed: r.reviewed,
    generatedAt: r.generatedAt?.toISOString() ?? null,
    issuedAt: r.issuedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    reason: r.reason,
    replacementForId: r.replacementForId,
    replacedById: r.replacedById,
  };
}
async function receipt(
  tx: AttendanceTransaction,
  actorId: string,
  key: string,
  fingerprint: string,
) {
  certificateId(key);
  // Actor-wide key lock prevents distinct group requests racing on the same key.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:${key}`}, 9))`,
  );
  const [r] = await tx
    .select()
    .from(s.certificateReceipts)
    .where(
      and(
        eq(s.certificateReceipts.actorId, actorId),
        eq(s.certificateReceipts.requestKey, key),
      ),
    );
  if (r && r.fingerprint !== fingerprint)
    throw new CertificateError(
      "IDEMPOTENCY_CONFLICT",
      "La clave ya se usó con otros datos.",
    );
  return r;
}
export class DrizzleCertificateRepository implements CertificateRepository {
  constructor(
    private readonly db: AttendanceDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  getSettings(actorId: string) {
    return this.db.transaction(async (tx) => {
      await certificateActor(tx, actorId);
      const [r] = await tx
        .select()
        .from(s.certificateSettings)
        .where(eq(s.certificateSettings.id, 1));
      return {
        revision: r?.revision ?? 0,
        configuration:
          r?.configuration ?? structuredClone(defaultCertificateConfiguration),
      };
    });
  }
  updateSettings(
    actorId: string,
    expected: number,
    configuration: CertificateConfiguration,
  ) {
    validateCertificateConfiguration(configuration);
    return this.db.transaction(async (tx) => {
      const { actor } = await certificateActor(tx, actorId);
      const [r] = await tx
        .select()
        .from(s.certificateSettings)
        .where(eq(s.certificateSettings.id, 1))
        .for("update");
      revision(r?.revision ?? 0, expected);
      const result = { revision: expected + 1, configuration };
      await tx
        .insert(s.certificateSettings)
        .values({ id: 1, ...result, updatedBy: actorId })
        .onConflictDoUpdate({
          target: s.certificateSettings.id,
          set: { ...result, updatedBy: actorId },
        });
      await tx.insert(s.auditEvents).values({
        actorId: actor.id,
        entityType: "CERTIFICATE_SETTINGS",
        entityId: "00000000-0000-4000-8000-000000000001",
        action: "CERTIFICATE_SETTINGS_UPDATED",
        metadata: { revision: result.revision },
      });
      return result;
    });
  }
  list(actorId: string, courseId: string, groupId: string) {
    return this.db.transaction(async (tx) => {
      const { admin } = await certificateActor(tx, actorId, false);
      await certificateGroup(tx, courseId, groupId);
      // Historical snapshot ownership, not the current course assignment.
      if (!admin) {
        const versions = await tx
          .select({ report: s.academicClosureVersions.report })
          .from(s.academicClosureVersions)
          .where(
            and(
              eq(s.academicClosureVersions.courseId, courseId),
              eq(s.academicClosureVersions.groupId, groupId),
            ),
          );
        if (!versions.some((v) => v.report.instructorId === actorId))
          throw new CertificateError("NOT_FOUND", "Grupo no disponible.");
      }
      const rows = await tx
        .select()
        .from(s.certificates)
        .where(
          and(
            eq(s.certificates.groupId, groupId),
            eq(s.certificates.courseId, courseId),
            ...(!admin ? [eq(s.certificates.instructorId, actorId)] : []),
          ),
        )
        .orderBy(asc(s.certificates.createdAt), asc(s.certificates.id));
      return Promise.all(rows.map((r) => dto(tx, r)));
    });
  }
  get(actorId: string, id: string) {
    return this.db.transaction(async (tx) => {
      const { admin } = await certificateActor(tx, actorId, false);
      const r = await rowById(tx, id);
      if (!admin && r.instructorId !== actorId)
        throw new CertificateError("NOT_FOUND", "Certificado no disponible.");
      return dto(tx, r);
    });
  }
  async verify(code: string) {
    if (!/^[A-Za-z0-9_-]{32}$/u.test(code))
      return { state: "not_found", valid: false } as const;
    const [r] = await this.db
      .select({
        state: s.certificates.state,
        data: s.certificates.data,
        hash: s.certificates.signedSha256,
      })
      .from(s.certificates)
      .where(eq(s.certificates.publicCredentialId, code));
    return r
      ? publicCertificate(r.state, r.data, r.hash)
      : ({ state: "not_found", valid: false } as const);
  }
  history(actorId: string, id: string) {
    return this.db.transaction(async (tx) => {
      await certificateActor(tx, actorId);
      await rowById(tx, id);
      const events = await tx
        .select()
        .from(s.certificateEvents)
        .where(eq(s.certificateEvents.certificateId, id))
        .orderBy(
          asc(s.certificateEvents.createdAt),
          asc(s.certificateEvents.id),
        );
      return events.map((e) => ({
        id: e.id,
        certificateId: e.certificateId,
        actorId: e.actorId,
        actorName: e.actorName,
        action: e.action,
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
      }));
    });
  }
  prepare(
    actorId: string,
    input: GenerateCertificatesInput,
    verificationOrigin: string,
  ) {
    certificateId(input.versionId);
    if (input.recipientId) certificateId(input.recipientId);
    if (input.replacementForId) {
      certificateId(input.replacementForId);
      certificateText(input.reason ?? "", "reason");
      if (!input.recipientId)
        throw new CertificateError(
          "VALIDATION_FAILED",
          "Reemplazo requiere un destinatario individual.",
        );
    }
    return this.db.transaction(async (tx) => {
      const { actor } = await certificateActor(tx, actorId);
      const fingerprint = digest({
        operation: "PREPARE",
        input,
        verificationOrigin,
      });
      const previous = await receipt(
        tx,
        actorId,
        input.requestKey,
        fingerprint,
      );
      if (previous)
        return Promise.all(
          previous.result.map(async (id) => dto(tx, await rowById(tx, id))),
        );
      const ctx = await certificateGroup(tx, input.courseId, input.groupId);
      const [v] = await tx
        .select()
        .from(s.academicClosureVersions)
        .where(
          and(
            eq(s.academicClosureVersions.id, input.versionId),
            eq(s.academicClosureVersions.courseId, input.courseId),
            eq(s.academicClosureVersions.groupId, input.groupId),
          ),
        );
      if (!v)
        throw new CertificateError(
          "STALE_CLOSURE",
          "Versión oficial no disponible.",
        );
      requireCurrentClosure(
        ctx.state?.closed ?? false,
        ctx.state?.lastVersion ?? 0,
        v.version,
      );
      revision(ctx.state!.revision, input.closureRevision);
      const [settings] = await tx
        .select()
        .from(s.certificateSettings)
        .where(eq(s.certificateSettings.id, 1))
        .for("share");
      revision(settings?.revision ?? 0, input.configurationRevision);
      const config = settings?.configuration ?? defaultCertificateConfiguration;
      validateCertificateConfiguration(config, true, input.type);
      const eligible = certificateRecipients(v.report, input.type);
      const recipients = input.recipientId
        ? eligible.filter((r) => r.id === input.recipientId)
        : eligible;
      if (!recipients.length)
        throw new CertificateError(
          "NOT_ELIGIBLE",
          "No hay destinatarios elegibles en la versión oficial.",
        );
      const [format] = await tx
        .select()
        .from(s.courseTypeRevisions)
        .where(eq(s.courseTypeRevisions.id, ctx.group.courseTypeRevisionId));
      if (
        !format ||
        ctx.course.courseTypeRevisionId !== ctx.group.courseTypeRevisionId
      )
        throw new CertificateError(
          "VALIDATION_FAILED",
          "La revisión nominal del formato no coincide.",
        );
      const groups = await tx
        .select({ id: s.groups.id })
        .from(s.groups)
        .where(eq(s.groups.courseId, input.courseId))
        .orderBy(asc(s.groups.createdAt), asc(s.groups.id));
      const groupNumber =
        input.groupNumber ??
        groups.findIndex((g) => g.id === input.groupId) + 1;
      const result: Row[] = [];
      for (const recipient of recipients) {
        const active = await tx
          .select()
          .from(s.certificates)
          .where(
            and(
              eq(s.certificates.courseId, input.courseId),
              eq(s.certificates.type, input.type),
              eq(s.certificates.recipientId, recipient.id),
              eq(s.certificates.state, "issued"),
            ),
          )
          .for("update");
        if (active.length && active[0]!.id !== input.replacementForId)
          throw new CertificateError(
            "ACTIVE_CERTIFICATE_EXISTS",
            "Ya existe una credencial vigente. Usa reemplazo explícito.",
          );
        if (input.replacementForId) {
          const old = await rowById(tx, input.replacementForId);
          if (
            old.courseId !== input.courseId ||
            old.type !== input.type ||
            old.recipientId !== recipient.id ||
            !["issued", "revoked"].includes(old.state) ||
            old.replacedById
          )
            throw new CertificateError(
              "INVALID_STATE",
              "El certificado no admite este reemplazo.",
            );
        }
        const publicCredentialId = randomBytes(24).toString("base64url");
        const data = freezeCertificateData({
          type: input.type,
          publicCredentialId,
          verificationOrigin,
          recipientName: recipient.name,
          courseName: v.report.courseName,
          instructorName: v.report.instructorName!,
          courseStartsAt: ctx.course.startsAt,
          courseEndsAt: ctx.course.endsAt,
          groupStartsAt: ctx.group.startsAt,
          groupEndsAt: ctx.group.endsAt,
          academicHours: format.totalHours,
          groupNumber,
          configuration: config,
          generatedAt: this.clock(),
        });
        const [row] = await tx
          .insert(s.certificates)
          .values({
            courseId: input.courseId,
            groupId: input.groupId,
            versionId: v.id,
            version: v.version,
            type: input.type,
            recipientId: recipient.id,
            instructorId: v.report.instructorId!,
            data,
            publicCredentialId,
            createdBy: actorId,
            replacementForId: input.replacementForId,
            reason: input.reason?.trim(),
            provenance: {
              configurationRevision: input.configurationRevision,
              courseRevision: ctx.course.updatedAt.toISOString(),
              groupRevision: ctx.group.updatedAt.toISOString(),
              courseTypeRevisionId: format.id,
              versionId: v.id,
              instructorId: v.report.instructorId!,
              courseStartsAt: ctx.course.startsAt.toISOString(),
              courseEndsAt: ctx.course.endsAt.toISOString(),
              groupStartsAt: ctx.group.startsAt.toISOString(),
              groupEndsAt: ctx.group.endsAt.toISOString(),
              academicHours: format.totalHours,
              groupNumber,
            },
          })
          .returning();
        if (!row) throw new Error("Certificate insertion failed");
        await event(tx, actor, row, "PREPARED", input.reason);
        result.push(row);
      }
      await tx.insert(s.certificateReceipts).values({
        actorId,
        requestKey: input.requestKey,
        fingerprint,
        result: result.map((r) => r.id),
      });
      return Promise.all(result.map((r) => dto(tx, r)));
    });
  }
  reserveArtifact(
    actorId: string,
    command: CertificateCommand,
    purpose: "UNSIGNED" | "SIGNED",
    sha256: string,
  ): Promise<ArtifactReservation> {
    commandValid(command);
    if (!/^[0-9a-f]{64}$/u.test(sha256))
      throw new CertificateError("VALIDATION_FAILED", "Hash no válido.");
    return this.db.transaction(async (tx) => {
      await certificateActor(tx, actorId);
      const previous = await tx
        .select()
        .from(s.certificateArtifacts)
        .where(eq(s.certificateArtifacts.id, command.requestKey));
      if (previous[0]) {
        const p = previous[0];
        if (
          p.actorId !== actorId ||
          p.certificateId !== command.certificateId ||
          p.purpose !== purpose ||
          p.sha256 !== sha256 ||
          p.certificateRevision !== command.revision
        )
          throw new CertificateError(
            "IDEMPOTENCY_CONFLICT",
            "La clave de carga ya se usó con otros datos.",
          );
        if (p.status === "reserved")
          throw new CertificateError(
            "CONCURRENT_UPDATE",
            "La carga ya está en proceso. Espera y reintenta la misma solicitud.",
          );
        if (p.status !== "attached")
          throw new CertificateError(
            "INVALID_STATE",
            "Carga descartada. Usa una nueva clave de solicitud.",
          );
        return p;
      }
      await receipt(
        tx,
        actorId,
        command.requestKey,
        digest({ operation: "ARTIFACT", command, purpose, sha256 }),
      );
      const row = await rowById(tx, command.certificateId);
      await currentCertificate(tx, row);
      revision(row.revision, command.revision);
      if (
        !["pending", "generated", "awaiting_signature"].includes(row.state) ||
        (purpose === "UNSIGNED" && row.unsignedPath) ||
        (purpose === "SIGNED" && !row.unsignedPath)
      )
        throw new CertificateError(
          "INVALID_STATE",
          "El estado no admite esta carga.",
        );
      const [reservation] = await tx
        .insert(s.certificateArtifacts)
        .values({
          id: command.requestKey,
          certificateId: row.id,
          actorId,
          purpose,
          sha256,
          certificateRevision: row.revision,
          path: `${row.id}/${purpose.toLowerCase()}/${randomUUID()}.pdf`,
        })
        .returning();
      if (!reservation) throw new Error("Artifact reservation failed");
      await tx.insert(s.certificateReceipts).values({
        actorId,
        requestKey: command.requestKey,
        fingerprint: digest({
          operation: "ARTIFACT",
          command,
          purpose,
          sha256,
        }),
        result: [row.id],
      });
      return reservation;
    });
  }
  attachArtifact(actorId: string, reservation: ArtifactReservation) {
    return this.db.transaction(async (tx) => {
      const { actor } = await certificateActor(tx, actorId);
      const [artifact] = await tx
        .select()
        .from(s.certificateArtifacts)
        .where(eq(s.certificateArtifacts.id, reservation.id))
        .for("update");
      if (
        !artifact ||
        artifact.actorId !== actorId ||
        artifact.path !== reservation.path
      )
        throw new CertificateError("NOT_FOUND", "Reserva no disponible.");
      const row = await rowById(tx, artifact.certificateId);
      if (artifact.status === "attached") return dto(tx, row);
      if (artifact.status !== "reserved")
        throw new CertificateError("INVALID_STATE", "Carga descartada.");
      await currentCertificate(tx, row);
      revision(row.revision, artifact.certificateRevision);
      if (!["pending", "generated", "awaiting_signature"].includes(row.state))
        throw new CertificateError("INVALID_STATE", "Documento inmutable.");
      const unsigned = artifact.purpose === "UNSIGNED";
      const [updated] = await tx
        .update(s.certificates)
        .set(
          unsigned
            ? {
                unsignedPath: artifact.path,
                state: "generated",
                generatedAt: this.clock(),
                revision: row.revision + 1,
              }
            : {
                signedPath: artifact.path,
                signedSha256: artifact.sha256,
                reviewed: false,
                state: "awaiting_signature",
                revision: row.revision + 1,
              },
        )
        .where(eq(s.certificates.id, row.id))
        .returning();
      await tx
        .update(s.certificateArtifacts)
        .set({ status: "attached" })
        .where(eq(s.certificateArtifacts.id, artifact.id));
      await event(
        tx,
        actor,
        row,
        unsigned ? "GENERATED" : "SIGNED_PDF_UPLOADED",
      );
      return dto(tx, updated!);
    });
  }
  async abandonArtifact(id: string) {
    const claimed = await this.db
      .update(s.certificateArtifacts)
      .set({ status: "cleanup_pending" })
      .where(
        and(
          eq(s.certificateArtifacts.id, id),
          eq(s.certificateArtifacts.status, "reserved"),
        ),
      )
      .returning({ id: s.certificateArtifacts.id });
    return claimed.length === 1;
  }
  async cleanedArtifact(id: string) {
    await this.db
      .update(s.certificateArtifacts)
      .set({ status: "cleaned" })
      .where(
        and(
          eq(s.certificateArtifacts.id, id),
          eq(s.certificateArtifacts.status, "cleanup_pending"),
        ),
      );
  }
  cleanupCandidates(actorId: string, before: Date) {
    return this.db.transaction(async (tx) => {
      await certificateActor(tx, actorId);
      // Expired reservations cannot subsequently attach after this claim.
      await tx
        .update(s.certificateArtifacts)
        .set({ status: "cleanup_pending" })
        .where(
          and(
            eq(s.certificateArtifacts.status, "reserved"),
            lt(s.certificateArtifacts.createdAt, before),
          ),
        );
      return tx
        .select()
        .from(s.certificateArtifacts)
        .where(eq(s.certificateArtifacts.status, "cleanup_pending"));
    });
  }
  private mutate(
    actorId: string,
    command: CertificateCommand,
    operation: "REVIEW" | "ISSUE" | "REVOKE",
    reason?: string,
  ) {
    commandValid(command);
    if (operation === "REVOKE")
      reason = certificateText(reason ?? "", "reason");
    return this.db.transaction(async (tx) => {
      const { actor } = await certificateActor(tx, actorId);
      const fingerprint = digest({ command, operation, reason });
      const prior = await receipt(tx, actorId, command.requestKey, fingerprint);
      if (prior) return dto(tx, await rowById(tx, prior.result[0]!));
      const row = await rowById(tx, command.certificateId);
      revision(row.revision, command.revision);
      if (operation !== "REVOKE") await currentCertificate(tx, row);
      let changes: Partial<typeof s.certificates.$inferInsert>;
      if (operation === "REVIEW") {
        if (
          row.state !== "awaiting_signature" ||
          !row.signedPath ||
          !row.signedSha256
        )
          throw new CertificateError(
            "INVALID_STATE",
            "Carga el PDF firmado antes de revisarlo.",
          );
        changes = { reviewed: true };
      } else if (operation === "REVOKE") {
        if (row.state !== "issued")
          throw new CertificateError(
            "INVALID_STATE",
            "Solo se revoca una credencial vigente.",
          );
        changes = { state: "revoked", revokedAt: this.clock(), reason };
      } else {
        if (
          row.state !== "awaiting_signature" ||
          !row.reviewed ||
          !row.signedPath ||
          !row.signedSha256
        )
          throw new CertificateError(
            "INVALID_STATE",
            "Revisa el PDF final firmado antes de emitir.",
          );
        const active = await tx
          .select()
          .from(s.certificates)
          .where(
            and(
              eq(s.certificates.courseId, row.courseId),
              eq(s.certificates.type, row.type),
              eq(s.certificates.recipientId, row.recipientId),
              eq(s.certificates.state, "issued"),
            ),
          )
          .for("update");
        if (active.length && active[0]!.id !== row.replacementForId)
          throw new CertificateError(
            "ACTIVE_CERTIFICATE_EXISTS",
            "Ya existe una credencial vigente.",
          );
        if (row.replacementForId) {
          const old = await rowById(tx, row.replacementForId);
          if (
            !["issued", "revoked"].includes(old.state) ||
            old.replacedById ||
            old.courseId !== row.courseId ||
            old.recipientId !== row.recipientId ||
            old.type !== row.type
          )
            throw new CertificateError(
              "INVALID_STATE",
              "Reemplazo no disponible.",
            );
          await tx
            .update(s.certificates)
            .set({
              state: "replaced",
              replacedById: row.id,
              reason: row.reason,
              revokedAt: this.clock(),
              revision: old.revision + 1,
            })
            .where(eq(s.certificates.id, old.id));
          await event(tx, actor, old, "REPLACED", row.reason ?? undefined);
        }
        changes = { state: "issued", issuedAt: this.clock() };
      }
      const [updated] = await tx
        .update(s.certificates)
        .set({ ...changes, revision: row.revision + 1 })
        .where(eq(s.certificates.id, row.id))
        .returning();
      await event(tx, actor, row, operation, reason);
      await tx.insert(s.certificateReceipts).values({
        actorId,
        requestKey: command.requestKey,
        fingerprint,
        result: [row.id],
      });
      return dto(tx, updated!);
    });
  }
  review(actorId: string, command: CertificateCommand) {
    return this.mutate(actorId, command, "REVIEW");
  }
  issue(actorId: string, command: CertificateCommand) {
    return this.mutate(actorId, command, "ISSUE");
  }
  revoke(actorId: string, command: CertificateCommand, reason: string) {
    return this.mutate(actorId, command, "REVOKE", reason);
  }
  downloadPath(actorId: string, id: string, purpose: "UNSIGNED" | "SIGNED") {
    return this.db.transaction(async (tx) => {
      const { admin } = await certificateActor(tx, actorId, false);
      const row = await rowById(tx, id);
      if (!admin && row.instructorId !== actorId)
        throw new CertificateError("NOT_FOUND", "Certificado no disponible.");
      const path = purpose === "UNSIGNED" ? row.unsignedPath : row.signedPath;
      if (!path)
        throw new CertificateError("NOT_FOUND", "Archivo no disponible.");
      return path;
    });
  }
}
