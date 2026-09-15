import { sql } from "drizzle-orm";
import {
  check,
  index,
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
