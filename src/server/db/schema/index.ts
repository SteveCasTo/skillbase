import { sql } from "drizzle-orm";
import {
  check,
  boolean,
  decimal,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AdminRegistrationDto,
  ParticipantDto,
  RegistrationDetailDto,
  RegistrationSettings,
} from "@/domain/pre-registrations/types";

export const userStatus = pgEnum("user_status", [
  "INVITED",
  "ACTIVE",
  "DISABLED",
]);

export const courseStatus = pgEnum("course_status", [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
]);
export const courseLevel = pgEnum("course_level", [
  "BASIC",
  "INTERMEDIATE",
  "ADVANCED",
]);
export const participantType = pgEnum("participant_type", [
  "STUDENT",
  "EXTERNAL",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authUserId: uuid("auth_user_id"),
    approvedGoogleIdentityId: text("approved_google_identity_id"),
    authPrimaryProvider: text("auth_primary_provider")
      .$type<"GOOGLE" | "EMAIL">()
      .notNull()
      .default("GOOGLE"),
    email: text("email").notNull(),
    name: text("name").notNull(),
    status: userStatus("status").notNull().default("INVITED"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_auth_user_id_unique").on(table.authUserId),
    index("users_status_idx").on(table.status),
    check(
      "users_auth_primary_provider_check",
      sql`${table.authPrimaryProvider} in ('GOOGLE', 'EMAIL')`,
    ),
    check(
      "users_email_normalized_check",
      sql`${table.email} = lower(btrim(${table.email})) and position('@' in ${table.email}) > 1`,
    ),
    check("users_name_not_blank_check", sql`length(btrim(${table.name})) > 0`),
    check(
      "users_invitation_link_check",
      sql`(${table.status} = 'INVITED' and ${table.authUserId} is null) or (${table.status} <> 'INVITED' and ${table.authUserId} is not null)`,
    ),
  ],
);

export const roles = pgTable(
  "roles",
  {
    code: text("code").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("roles_code_check", sql`${table.code} in ('ADMIN', 'INSTRUCTOR')`),
  ],
);

// Durable outbox: Auth deletion is external to PostgreSQL. Pending rows keep access disabled.
export const instructorAccountDeletions = pgTable(
  "instructor_account_deletions",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    authUserId: uuid("auth_user_id").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("instructor_account_deletions_actor_idx").on(table.actorId),
  ],
).enableRLS();

export const authAttemptBuckets = pgTable(
  "auth_attempt_buckets",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.windowStart] }),
    index("auth_attempt_buckets_expiry_idx").on(table.expiresAt),
    check("auth_attempt_buckets_attempts_check", sql`${table.attempts} > 0`),
  ],
).enableRLS();

export const authGoogleLinkRequests = pgTable(
  "auth_google_link_requests",
  {
    nonceHash: text("nonce_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("auth_google_link_requests_user_idx").on(table.userId),
    index("auth_google_link_requests_expiry_idx").on(table.expiresAt),
  ],
).enableRLS();

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleCode: text("role_code")
      .notNull()
      .references(() => roles.code, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleCode] }),
    index("user_roles_role_code_idx").on(table.roleCode),
  ],
);

export const instructorProfiles = pgTable(
  "instructor_profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "instructor_profiles_first_name_check",
      sql`char_length(${table.firstName}) between 1 and 100 and ${table.firstName} = btrim(${table.firstName}) and ${table.firstName} !~ '[[:cntrl:]]'`,
    ),
    check(
      "instructor_profiles_last_name_check",
      sql`char_length(${table.lastName}) between 1 and 150 and ${table.lastName} = btrim(${table.lastName}) and ${table.lastName} !~ '[[:cntrl:]]'`,
    ),
    check(
      "instructor_profiles_phone_check",
      sql`${table.phone} is null or (char_length(${table.phone}) between 1 and 32 and ${table.phone} = btrim(${table.phone}) and ${table.phone} !~ '[[:cntrl:]]')`,
    ),
  ],
).enableRLS();

export const courseTypes = pgTable(
  "course_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "course_types_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`,
    ),
  ],
);

export const courseTypeRevisions = pgTable(
  "course_type_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    courseTypeId: uuid("course_type_id")
      .notNull()
      .references(() => courseTypes.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    totalHours: integer("total_hours").notNull(),
    // NULL marks historical terms whose session duration was never recorded.
    sessionMinutes: integer("session_minutes"),
    studentAmount: decimal("student_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    externalAmount: decimal("external_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("course_type_revisions_type_number_unique").on(
      table.courseTypeId,
      table.revisionNumber,
    ),
    index("course_type_revisions_type_idx").on(table.courseTypeId),
    check("course_type_revisions_hours_check", sql`${table.totalHours} > 0`),
    check(
      "course_type_revisions_session_minutes_check",
      sql`${table.sessionMinutes} between 15 and 480`,
    ),
    check(
      "course_type_revisions_prices_check",
      sql`${table.studentAmount} >= 0 and ${table.externalAmount} >= 0`,
    ),
    check(
      "course_type_revisions_number_check",
      sql`${table.revisionNumber} > 0`,
    ),
  ],
);

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull(),
    level: courseLevel("level").notNull(),
    courseTypeRevisionId: uuid("course_type_revision_id")
      .notNull()
      .references(() => courseTypeRevisions.id, { onDelete: "restrict" }),
    contentMarkdown: text("content_markdown"),
    instructorName: text("instructor_name"),
    instructorId: uuid("instructor_id").references(
      () => instructorProfiles.id,
      { onDelete: "restrict" },
    ),
    artwork: text("artwork"),
    featured: boolean("featured").notNull().default(false),
    schedule: text("schedule").notNull(),
    weekdaysMask: integer("weekdays_mask"),
    conditions: text("conditions").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    registrationStartAt: timestamp("registration_start_at", {
      withTimezone: true,
    }),
    registrationEndAt: timestamp("registration_end_at", {
      withTimezone: true,
    }),
    minimumGrade: integer("minimum_grade").notNull(),
    status: courseStatus("status").notNull().default("DRAFT"),
    createActorId: uuid("create_actor_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createRequestKey: uuid("create_request_key"),
    createFingerprint: text("create_fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("courses_slug_unique").on(table.slug),
    uniqueIndex("courses_create_request_unique").on(
      table.createActorId,
      table.createRequestKey,
    ),
    check(
      "courses_create_request_check",
      sql`(${table.createActorId} is null and ${table.createRequestKey} is null and ${table.createFingerprint} is null) or (${table.createActorId} is not null and ${table.createRequestKey} is not null and ${table.createFingerprint} is not null and ${table.createFingerprint} ~ '^[0-9a-f]{64}$')`,
    ),
    index("courses_status_idx").on(table.status),
    index("courses_instructor_id_idx").on(table.instructorId),
    index("courses_status_created_at_idx").on(table.status, table.createdAt),
    index("courses_course_type_revision_idx").on(table.courseTypeRevisionId),
    unique("courses_id_course_type_revision_id_unique").on(
      table.id,
      table.courseTypeRevisionId,
    ),
    uniqueIndex("courses_one_published_featured_unique")
      .on(table.featured)
      .where(sql`${table.status} = 'PUBLISHED' and ${table.featured} = true`),
    check(
      "courses_featured_published_check",
      sql`not ${table.featured} or ${table.status} = 'PUBLISHED'`,
    ),
    check(
      "courses_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`,
    ),
    check(
      "courses_description_not_blank_check",
      sql`length(btrim(${table.description})) > 0`,
    ),
    check(
      "courses_schedule_not_blank_check",
      sql`length(btrim(${table.schedule})) > 0`,
    ),
    check(
      "courses_conditions_not_blank_check",
      sql`length(btrim(${table.conditions})) > 0`,
    ),
    check(
      "courses_slug_format_check",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check(
      "courses_minimum_grade_check",
      sql`${table.minimumGrade} between 0 and 100`,
    ),
    check("courses_dates_check", sql`${table.startsAt} < ${table.endsAt}`),
    check(
      "courses_weekdays_mask_check",
      sql`${table.weekdaysMask} between 1 and 31`,
    ),
    check(
      "courses_registration_window_check",
      sql`(${table.registrationStartAt} is null and ${table.registrationEndAt} is null) or (${table.registrationStartAt} is not null and ${table.registrationEndAt} is not null and ${table.registrationStartAt} < ${table.registrationEndAt})`,
    ),
  ],
);

export const courseInstructorHistory = pgTable(
  "course_instructor_history",
  {
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    instructorId: uuid("instructor_id").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    firstAssignedAt: timestamp("first_assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.instructorId] }),
    foreignKey({
      name: "course_instructor_history_profile_fk",
      columns: [table.instructorId],
      foreignColumns: [instructorProfiles.id],
    }).onDelete("restrict"),
    index("course_instructor_history_instructor_idx").on(table.instructorId),
    index("course_instructor_history_actor_idx").on(table.actorId),
  ],
).enableRLS();

export const groupStatus = pgEnum("group_status", ["PLANNED", "CANCELLED"]);

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    courseId: uuid("course_id").notNull(),
    courseTypeRevisionId: uuid("course_type_revision_id").notNull(),
    capacity: integer("capacity").notNull(),
    status: groupStatus("status").notNull().default("PLANNED"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("groups_course_id_idx").on(table.courseId),
    unique("groups_course_id_id_unique").on(table.courseId, table.id),
    index("groups_course_type_revision_id_idx").on(table.courseTypeRevisionId),
    foreignKey({
      name: "groups_course_revision_fk",
      columns: [table.courseId, table.courseTypeRevisionId],
      foreignColumns: [courses.id, courses.courseTypeRevisionId],
    }).onDelete("restrict"),
    check("groups_capacity_check", sql`${table.capacity} > 0`),
    check("groups_dates_check", sql`${table.startsAt} < ${table.endsAt}`),
  ],
);

export const interestRegistrationStatus = pgEnum(
  "interest_registration_status",
  ["ACTIVE", "CANCELLED"],
);
export const interestRegistrations = pgTable(
  "interest_registrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    preferredGroupId: uuid("preferred_group_id"),
    status: interestRegistrationStatus("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("interest_registrations_course_email_unique").on(
      table.courseId,
      table.email,
    ),
    unique("interest_registrations_course_id_id_unique").on(
      table.courseId,
      table.id,
    ),
    foreignKey({
      name: "interest_registrations_course_group_fk",
      columns: [table.courseId, table.preferredGroupId],
      foreignColumns: [groups.courseId, groups.id],
    }).onDelete("restrict"),
    index("interest_registrations_course_status_created_idx").on(
      table.courseId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index("interest_registrations_course_preference_idx").on(
      table.courseId,
      table.preferredGroupId,
    ),
    check(
      "interest_registrations_first_name_check",
      sql`char_length(${table.firstName}) between 1 and 100 and ${table.firstName} = btrim(${table.firstName}) and ${table.firstName} !~ '[[:cntrl:]]'`,
    ),
    check(
      "interest_registrations_last_name_check",
      sql`char_length(${table.lastName}) between 1 and 150 and ${table.lastName} = btrim(${table.lastName}) and ${table.lastName} !~ '[[:cntrl:]]'`,
    ),
    check(
      "interest_registrations_email_check",
      sql`${table.email} = lower(btrim(${table.email})) and char_length(${table.email}) between 3 and 254 and ${table.email} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' and ${table.email} !~ '[[:cntrl:]]'`,
    ),
    check(
      "interest_registrations_phone_check",
      sql`${table.phone} is null or (char_length(${table.phone}) between 1 and 32 and ${table.phone} = btrim(${table.phone}) and ${table.phone} !~ '[[:cntrl:]]')`,
    ),
  ],
).enableRLS();

export const interestRegistrationRateLimits = pgTable(
  "interest_registration_rate_limits",
  {
    key: text("key").primaryKey(),
    attempts: integer("attempts").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("interest_registration_rate_limits_expiry_idx").on(table.expiresAt),
    check(
      "interest_registration_rate_limits_attempts_check",
      sql`${table.attempts} > 0`,
    ),
  ],
).enableRLS();

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_events_actor_id_idx").on(table.actorId),
    index("audit_events_entity_idx").on(table.entityType, table.entityId),
    index("audit_events_created_at_idx").on(table.createdAt),
    check(
      "audit_events_action_not_blank_check",
      sql`length(btrim(${table.action})) > 0`,
    ),
    check(
      "audit_events_entity_type_not_blank_check",
      sql`length(btrim(${table.entityType})) > 0`,
    ),
  ],
);

export const registrationParticipantType = pgEnum(
  "registration_participant_type",
  ["STUDENT", "EXTERNAL", "AUXILIARY"],
);
export const preRegistrationState = pgEnum("pre_registration_state", [
  "ACTIVE",
  "CANCELLED",
]);
export const registrationLedgerKind = pgEnum("registration_ledger_kind", [
  "PAYMENT",
  "REFUND",
]);

export const participants = pgTable(
  "participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ci: text("ci").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("participants_ci_unique").on(t.ci),
    check(
      "participants_ci_check",
      sql`char_length(${t.ci}) between 1 and 64 and ${t.ci} = upper(${t.ci}) and ${t.ci} !~ '[[:space:][:cntrl:]]'`,
    ),
    check(
      "participants_first_name_check",
      sql`char_length(${t.firstName}) between 1 and 100 and ${t.firstName} = btrim(${t.firstName}) and ${t.firstName} !~ '[[:cntrl:]]'`,
    ),
    check(
      "participants_last_name_check",
      sql`char_length(${t.lastName}) between 1 and 150 and ${t.lastName} = btrim(${t.lastName}) and ${t.lastName} !~ '[[:cntrl:]]'`,
    ),
    check(
      "participants_email_check",
      sql`${t.email} = lower(btrim(${t.email})) and char_length(${t.email}) between 3 and 254 and ${t.email} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' and ${t.email} !~ '[[:cntrl:]]'`,
    ),
    check(
      "participants_phone_check",
      sql`${t.phone} is null or (char_length(${t.phone}) between 1 and 32 and ${t.phone} = btrim(${t.phone}) and ${t.phone} !~ '[[:cntrl:]]')`,
    ),
  ],
).enableRLS();

export const registrationSettings = pgTable(
  "registration_settings",
  {
    id: integer("id").primaryKey().default(1),
    minimumPaymentPercent: integer("minimum_payment_percent")
      .notNull()
      .default(25),
    auxiliaryDiscountPercent: integer("auxiliary_discount_percent")
      .notNull()
      .default(50),
    revision: integer("revision").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("registration_settings_singleton_check", sql`${t.id} = 1`),
    check(
      "registration_settings_percent_check",
      sql`${t.minimumPaymentPercent} between 1 and 100 and ${t.auxiliaryDiscountPercent} between 0 and 100`,
    ),
    check(
      "registration_settings_revision_check",
      sql`${t.revision} > 0 and (${t.revision} = 1 or ${t.updatedBy} is not null)`,
    ),
    index("registration_settings_actor_idx").on(t.updatedBy),
  ],
).enableRLS();

export const preRegistrations = pgTable(
  "pre_registrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    courseId: uuid("course_id").notNull(),
    groupId: uuid("group_id").notNull(),
    courseTypeRevisionId: uuid("course_type_revision_id").notNull(),
    sourceInterestId: uuid("source_interest_id"),
    state: preRegistrationState("state").notNull().default("ACTIVE"),
    participantType: registrationParticipantType("participant_type").notNull(),
    currency: text("currency").notNull().default("BOB"),
    settingsRevision: integer("settings_revision").notNull(),
    basePriceCents: decimal("base_price_cents", {
      precision: 12,
      scale: 0,
    }).notNull(),
    discountPercent: integer("discount_percent").notNull(),
    totalPriceCents: decimal("total_price_cents", {
      precision: 12,
      scale: 0,
    }).notNull(),
    minimumPaymentPercent: integer("minimum_payment_percent").notNull(),
    minimumPaymentCents: decimal("minimum_payment_cents", {
      precision: 12,
      scale: 0,
    }).notNull(),
    firstDayException: boolean("first_day_exception").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      precision: 3,
    }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    cancellationReason: text("cancellation_reason").$type<
      "VOLUNTARY" | "GROUP_CANCELLED"
    >(),
    cancellationNote: text("cancellation_note"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "pre_registrations_course_group_fk",
      columns: [t.courseId, t.groupId],
      foreignColumns: [groups.courseId, groups.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pre_registrations_course_revision_fk",
      columns: [t.courseId, t.courseTypeRevisionId],
      foreignColumns: [courses.id, courses.courseTypeRevisionId],
    }).onDelete("restrict"),
    foreignKey({
      name: "pre_registrations_course_interest_fk",
      columns: [t.courseId, t.sourceInterestId],
      foreignColumns: [
        interestRegistrations.courseId,
        interestRegistrations.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("pre_registrations_active_person_course_unique")
      .on(t.participantId, t.courseId)
      .where(sql`${t.state} = 'ACTIVE'`),
    index("pre_registrations_course_group_state_idx").on(
      t.courseId,
      t.groupId,
      t.state,
      t.createdAt,
      t.id,
    ),
    index("pre_registrations_group_idx").on(t.groupId),
    index("pre_registrations_participant_idx").on(t.participantId),
    index("pre_registrations_revision_idx").on(t.courseTypeRevisionId),
    index("pre_registrations_interest_idx").on(t.sourceInterestId),
    index("pre_registrations_created_by_idx").on(t.createdBy),
    index("pre_registrations_cancelled_by_idx").on(t.cancelledBy),
    check(
      "pre_registrations_price_check",
      sql`${t.currency} = 'BOB' and ${t.settingsRevision} > 0 and ${t.basePriceCents} >= 0 and ${t.discountPercent} between 0 and 100 and (${t.participantType} = 'AUXILIARY' or ${t.discountPercent} = 0) and ${t.totalPriceCents} = floor((${t.basePriceCents} * (100 - ${t.discountPercent}) + 50) / 100) and ${t.minimumPaymentPercent} between 1 and 100 and ${t.minimumPaymentCents} = ceil(${t.totalPriceCents} * ${t.minimumPaymentPercent} / 100)`,
    ),
    check(
      "pre_registrations_cancelled_check",
      sql`(${t.state} = 'ACTIVE' and ${t.cancelledAt} is null and ${t.cancelledBy} is null and ${t.cancellationReason} is null and ${t.cancellationNote} is null) or (${t.state} = 'CANCELLED' and ${t.cancelledAt} is not null and ${t.cancelledBy} is not null and ${t.cancellationReason} is not null and ${t.cancellationReason} in ('VOLUNTARY', 'GROUP_CANCELLED') and ${t.cancellationNote} is not null and char_length(btrim(${t.cancellationNote})) between 1 and 500 and ${t.cancellationNote} !~ '[[:cntrl:]]')`,
    ),
  ],
).enableRLS();

export const registrationCommandReceipts = pgTable(
  "registration_command_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestKey: uuid("request_key").notNull(),
    operation: text("operation")
      .notNull()
      .$type<
        | "CREATE"
        | "PAYMENT"
        | "REFUND"
        | "CANCEL"
        | "TRANSFER"
        | "PARTICIPANT_UPDATE"
        | "SETTINGS_UPDATE"
        | "GROUP_CANCEL"
      >(),
    fingerprint: text("fingerprint").notNull(),
    result: jsonb("result")
      .$type<
        | AdminRegistrationDto
        | ParticipantDto
        | RegistrationDetailDto
        | RegistrationSettings
        | { cancelledRegistrationIds: string[]; refundDueCents: number }
      >()
      .notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("registration_command_receipts_actor_key_unique").on(
      t.actorId,
      t.requestKey,
    ),
    unique("registration_command_receipts_id_actor_unique").on(t.id, t.actorId),
    check(
      "registration_command_receipts_fingerprint_check",
      sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "registration_command_receipts_operation_check",
      sql`${t.operation} in ('CREATE', 'PAYMENT', 'REFUND', 'CANCEL', 'TRANSFER', 'PARTICIPANT_UPDATE', 'SETTINGS_UPDATE', 'GROUP_CANCEL')`,
    ),
    check(
      "registration_command_receipts_result_check",
      sql`jsonb_typeof(${t.result}) = 'object'`,
    ),
  ],
).enableRLS();

export const registrationLedger = pgTable(
  "registration_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => preRegistrations.id, { onDelete: "restrict" }),
    commandReceiptId: uuid("command_receipt_id").notNull(),
    kind: registrationLedgerKind("kind").notNull(),
    amountCents: decimal("amount_cents", { precision: 12, scale: 0 }).notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("registration_ledger_receipt_unique").on(t.commandReceiptId),
    foreignKey({
      name: "registration_ledger_receipt_actor_fk",
      columns: [t.commandReceiptId, t.actorId],
      foreignColumns: [
        registrationCommandReceipts.id,
        registrationCommandReceipts.actorId,
      ],
    }).onDelete("restrict"),
    index("registration_ledger_registration_recorded_idx").on(
      t.registrationId,
      t.recordedAt,
      t.id,
    ),
    index("registration_ledger_actor_idx").on(t.actorId),
    check("registration_ledger_amount_check", sql`${t.amountCents} > 0`),
    check(
      "registration_ledger_date_check",
      sql`${t.effectiveDate} <= (${t.recordedAt} at time zone 'America/La_Paz')::date`,
    ),
    check(
      "registration_ledger_reason_check",
      sql`char_length(btrim(${t.reason})) between 1 and 500 and ${t.reason} !~ '[[:cntrl:]]'`,
    ),
  ],
).enableRLS();
