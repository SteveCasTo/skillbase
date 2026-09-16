import { sql } from "drizzle-orm";
import {
  check,
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

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull(),
    level: courseLevel("level").notNull(),
    totalHours: integer("total_hours").notNull(),
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
    check("courses_total_hours_check", sql`${table.totalHours} > 0`),
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

export const coursePrices = pgTable(
  "course_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    participantType: participantType("participant_type").notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("BOB"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("course_prices_course_participant_unique").on(
      table.courseId,
      table.participantType,
    ),
    index("course_prices_course_id_idx").on(table.courseId),
    check("course_prices_amount_check", sql`${table.amount} >= 0`),
    check("course_prices_currency_check", sql`${table.currency} = 'BOB'`),
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
