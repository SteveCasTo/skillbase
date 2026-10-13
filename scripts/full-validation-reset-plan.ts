import { createHash } from "node:crypto";
import postgres from "postgres";

/** Operator-only inventory. This module cannot reset, migrate, seed or upload. */
export const FULL_VALIDATION_BUSINESS_TABLES = [
  "academic_closure_receipts",
  "academic_closure_versions",
  "academic_group_reopenings",
  "academic_group_states",
  "attendance_command_receipts",
  "audit_events",
  "certificate_artifacts",
  "certificate_events",
  "certificate_receipts",
  "certificates",
  "course_instructor_history",
  "course_type_revisions",
  "course_types",
  "courses",
  "evaluation_command_receipts",
  "evaluation_components",
  "evaluation_grades",
  "evaluation_results",
  "evaluation_schemes",
  "group_sessions",
  "groups",
  "instructor_attendance",
  "interest_registrations",
  "participant_attendance",
  "participants",
  "pre_registrations",
  "registration_command_receipts",
  "registration_ledger",
  "session_roster",
] as const;

export const FULL_VALIDATION_RETAINED_TABLES = [
  "admin_account_deletions",
  "attendance_settings",
  "auth_attempt_buckets",
  "auth_google_link_requests",
  "certificate_settings",
  "instructor_account_deletions",
  "instructor_profiles",
  "interest_registration_rate_limits",
  "registration_settings",
  "roles",
  "user_roles",
  "users",
] as const;

interface TableInventory {
  readonly table: string;
  readonly classification: "business" | "retained";
  readonly count: number;
  readonly fullRowsSha256: string;
  readonly primaryKeyColumns: readonly string[];
  readonly primaryKeys: readonly Record<string, unknown>[];
}

function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function fullValidationPlanHash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

/** Unknown tables block rather than being automatically adopted into a reset.
 * Update this reviewed inventory after the approved 0024/0025 schemas land. */
export async function captureFullValidationResetInventory(
  client: postgres.Sql,
) {
  return client.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const relations = await tx<{ tablename: string }[]>`
      select tablename from pg_catalog.pg_tables
      where schemaname = 'public' order by tablename
    `;
    const business = new Set<string>(FULL_VALIDATION_BUSINESS_TABLES);
    const retained = new Set<string>(FULL_VALIDATION_RETAINED_TABLES);
    const expected = new Set([...business, ...retained]);
    if (
      relations.length !== expected.size ||
      relations.some(({ tablename }) => !expected.has(tablename))
    )
      throw new Error(
        "Public schema changed; review the exact reset scope first",
      );

    const tables: TableInventory[] = [];
    for (const { tablename } of relations) {
      const keys = await tx<{ columnName: string }[]>`
        select a.attname as "columnName"
        from pg_catalog.pg_index i
        join pg_catalog.pg_class c on c.oid = i.indrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        join unnest(i.indkey) with ordinality k(attnum, ordinal) on true
        join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
        where n.nspname = 'public' and c.relname = ${tablename} and i.indisprimary
        order by k.ordinal
      `;
      if (!keys.length)
        throw new Error("Inventory requires explicit primary keys");
      const rows = await tx<{ record: Record<string, unknown> }[]>`
        select to_jsonb(t) as record from public.${tx(tablename)} t
        order by to_jsonb(t)::text
      `;
      const primaryKeyColumns = keys.map(({ columnName }) => columnName);
      tables.push({
        table: tablename,
        classification: business.has(tablename) ? "business" : "retained",
        count: rows.length,
        fullRowsSha256: fullValidationPlanHash(
          rows.map(({ record }) => record),
        ),
        primaryKeyColumns,
        primaryKeys: rows.map(({ record }) =>
          Object.fromEntries(
            primaryKeyColumns.map((key) => [key, record[key]]),
          ),
        ),
      });
    }

    const columns = await tx`
      select c.relname as relation, a.attname as name,
        pg_catalog.format_type(a.atttypid,a.atttypmod) as type,
        a.attnotnull as "notNull",
        pg_get_expr(d.adbin,d.adrelid) as "defaultExpression"
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on c.oid=a.attrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      left join pg_catalog.pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
      where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
      order by c.relname,a.attnum
    `;
    const foreignKeys = await tx`
      select n.nspname as schema, c.relname as relation, con.conname as name,
        rn.nspname as "referencedSchema", rc.relname as "referencedRelation",
        pg_get_constraintdef(con.oid) as definition
      from pg_catalog.pg_constraint con
      join pg_catalog.pg_class c on c.oid = con.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_class rc on rc.oid = con.confrelid
      join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace
      where con.contype = 'f' and (n.nspname = 'public' or rn.nspname = 'public')
      order by n.nspname, c.relname, con.conname
    `;
    const triggers = await tx`
      select c.relname as relation, t.tgname as name, t.tgenabled as enabled,
        pg_get_triggerdef(t.oid) as definition,
        pg_get_functiondef(t.tgfoid) as "functionDefinition"
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal
      order by c.relname, t.tgname
    `;
    const ledger = await tx`
      select id, hash, created_at::text as "createdAt"
      from drizzle.__drizzle_migrations order by id
    `;
    const settings = await tx`
      select 'certificate_settings' as relation, to_jsonb(t) as record
      from public.certificate_settings t
      union all select 'registration_settings', to_jsonb(t)
      from public.registration_settings t
      union all select 'attendance_settings', to_jsonb(t)
      from public.attendance_settings t
    `;
    const buckets = await tx`
      select id, public, file_size_limit, allowed_mime_types
      from storage.buckets order by id
    `;
    const objects = await tx`
      select id, bucket_id, name, metadata, created_at, updated_at
      from storage.objects order by bucket_id, name
    `;
    // Auth provider tables/credentials are deliberately not selected.
    const inventory = {
      mode: "READ_ONLY_INVENTORY_NOT_APPLYABLE",
      tables,
      columns: Array.from(columns),
      foreignKeys: Array.from(foreignKeys),
      triggers: Array.from(triggers),
      ledger: Array.from(ledger),
      settings: Array.from(settings),
      buckets: Array.from(buckets),
      objects: Array.from(objects),
      limitations: [
        "Schema/ownership/service contracts and remaining classifications require MAIN review",
        "No principal/target approval or destructive capability is granted by this inventory",
        "Storage metadata is not a fresh hash/download of private object bytes",
        "Auth technical table fingerprints may change during genuine QA login/logout",
      ],
    };
    return { inventory, inventorySha256: fullValidationPlanHash(inventory) };
  });
}
