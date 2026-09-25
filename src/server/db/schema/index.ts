import { sql } from "drizzle-orm";
import {
  check,
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
    artwork: text("artwork"),
    featured: boolean("featured").notNull().default(false),
    schedule: text("schedule").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("courses_slug_unique").on(table.slug),
    index("courses_status_idx").on(table.status),
    index("courses_status_created_at_idx").on(table.status, table.createdAt),
    index("courses_course_type_revision_idx").on(table.courseTypeRevisionId),
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
      "courses_registration_window_check",
      sql`(${table.registrationStartAt} is null and ${table.registrationEndAt} is null) or (${table.registrationStartAt} is not null and ${table.registrationEndAt} is not null and ${table.registrationStartAt} < ${table.registrationEndAt})`,
    ),
  ],
);

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
