import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { users, courses, groups, academicClosureVersions } from "./index";
import type {
  CertificateConfiguration,
  CertificateProvenance,
  CertificateState,
  CertificateTemplateData,
  CertificateType,
} from "@/domain/certificates/types";

export const certificateSettings = pgTable(
  "certificate_settings",
  {
    id: integer("id").primaryKey().default(1),
    revision: integer("revision").notNull().default(0),
    configuration: jsonb("configuration")
      .$type<CertificateConfiguration>()
      .notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (t) => [
    check(
      "certificate_settings_singleton",
      sql`${t.id} = 1 and ${t.revision} >= 0`,
    ),
    index("certificate_settings_actor_idx").on(t.updatedBy),
  ],
).enableRLS();
export const certificates = pgTable(
  "certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicCredentialId: text("public_credential_id").notNull(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    groupId: uuid("group_id").notNull(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => academicClosureVersions.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    type: text("type").$type<CertificateType>().notNull(),
    recipientId: uuid("recipient_id").notNull(),
    instructorId: uuid("instructor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    state: text("state").$type<CertificateState>().notNull().default("pending"),
    revision: integer("revision").notNull().default(0),
    data: jsonb("data").$type<CertificateTemplateData>().notNull(),
    provenance: jsonb("provenance").$type<CertificateProvenance>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    generatedAt: timestamp("generated_at", {
      withTimezone: true,
      precision: 3,
    }),
    issuedAt: timestamp("issued_at", { withTimezone: true, precision: 3 }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, precision: 3 }),
    reason: text("reason"),
    unsignedPath: text("unsigned_path"),
    signedPath: text("signed_path"),
    signedSha256: text("signed_sha256"),
    reviewed: boolean("reviewed").notNull().default(false),
    replacementForId: uuid("replacement_for_id"),
    replacedById: uuid("replaced_by_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.courseId, t.groupId],
      foreignColumns: [groups.courseId, groups.id],
      name: "certificates_course_group_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.replacementForId],
      foreignColumns: [t.id],
      name: "certificates_replacement_for_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.replacedById],
      foreignColumns: [t.id],
      name: "certificates_replaced_by_fk",
    }).onDelete("restrict"),
    uniqueIndex("certificates_public_id_unique").on(t.publicCredentialId),
    uniqueIndex("certificates_one_active_unique")
      .on(t.courseId, t.type, t.recipientId)
      .where(sql`${t.state} = 'issued'`),
    index("certificates_group_idx").on(t.groupId),
    index("certificates_version_idx").on(t.versionId),
    index("certificates_instructor_idx").on(t.instructorId),
    index("certificates_actor_idx").on(t.createdBy),
    index("certificates_replacement_idx").on(t.replacementForId),
    index("certificates_replaced_idx").on(t.replacedById),
    check(
      "certificates_values_check",
      sql`${t.type} in ('APPROVAL','INSTRUCTOR') and ${t.state} in ('pending','generated','awaiting_signature','issued','revoked','replaced') and ${t.version} > 0 and ${t.revision} >= 0 and ${t.publicCredentialId} ~ '^[A-Za-z0-9_-]{32}$' and (${t.signedSha256} is null or ${t.signedSha256} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "certificates_issued_check",
      sql`${t.state} not in ('issued','revoked','replaced') or (${t.signedPath} is not null and ${t.signedSha256} is not null and ${t.issuedAt} is not null and ${t.reviewed})`,
    ),
  ],
).enableRLS();
export const certificateEvents = pgTable(
  "certificate_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    certificateId: uuid("certificate_id")
      .notNull()
      .references(() => certificates.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("certificate_events_certificate_idx").on(t.certificateId),
    index("certificate_events_actor_idx").on(t.actorId),
  ],
).enableRLS();
export const certificateReceipts = pgTable(
  "certificate_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestKey: uuid("request_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    result: jsonb("result").$type<string[]>().notNull(),
  },
  (t) => [
    uniqueIndex("certificate_receipts_actor_key_unique").on(
      t.actorId,
      t.requestKey,
    ),
  ],
).enableRLS();
/** Reservation is committed before Storage I/O. Failed/abandoned objects retain cleanup evidence. */
export const certificateArtifacts = pgTable(
  "certificate_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    certificateId: uuid("certificate_id")
      .notNull()
      .references(() => certificates.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    path: text("path").notNull(),
    purpose: text("purpose").$type<"UNSIGNED" | "SIGNED">().notNull(),
    sha256: text("sha256").notNull(),
    certificateRevision: integer("certificate_revision").notNull(),
    status: text("status")
      .$type<"reserved" | "attached" | "cleanup_pending" | "cleaned">()
      .notNull()
      .default("reserved"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("certificate_artifacts_path_unique").on(t.path),
    index("certificate_artifacts_certificate_idx").on(t.certificateId),
    index("certificate_artifacts_actor_idx").on(t.actorId),
    index("certificate_artifacts_cleanup_idx").on(t.status, t.createdAt),
  ],
).enableRLS();
