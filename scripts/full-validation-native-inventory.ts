import { spawnSync } from "node:child_process";
import type postgres from "postgres";
import {
  FULL_VALIDATION_BUSINESS_TABLES,
  FULL_VALIDATION_RETAINED_TABLES,
  fullValidationPlanHash,
} from "./full-validation-reset-plan";
import { PRODUCTION_PROJECT } from "./financial-demo-plan";

const tables = [
  ...FULL_VALIDATION_BUSINESS_TABLES,
  ...FULL_VALIDATION_RETAINED_TABLES,
].sort();

/** All identifiers are source-owned constants, never database/user text. This
 * native CLI transport uses its existing authenticated provider session and
 * does not read/export a PostgreSQL password, service key or access token. */
export function fullValidationNativeReadSql(): string {
  const inventory = tables.map((table) => {
    if (!/^[a-z_]+$/u.test(table)) throw new Error("Invalid source table name");
    return `jsonb_build_object(
      'table','${table}',
      'classification','${FULL_VALIDATION_BUSINESS_TABLES.some((t) => t === table) ? "business" : "retained"}',
      'count',(select count(*) from public.${table}),
      'fullRowsSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]'),'UTF8')),'hex') from public.${table} t),
      'primaryKeys',(select coalesce(jsonb_agg(k.value order by k.value::text),'[]') from public.${table} t cross join lateral (
        select jsonb_object_agg(a.attname,to_jsonb(t)->a.attname) as value
        from pg_index i join pg_class c on c.oid=i.indrelid
        join pg_namespace n on n.oid=c.relnamespace
        join unnest(i.indkey) key(attnum) on true
        join pg_attribute a on a.attrelid=c.oid and a.attnum=key.attnum
        where n.nspname='public' and c.relname='${table}' and i.indisprimary
      ) k)
    )`;
  });
  return `begin transaction isolation level repeatable read read only;
select jsonb_build_object(
  'mode','READ_ONLY_INVENTORY_NOT_APPLYABLE',
  'hashScheme','postgres-jsonb-sha256-v1',
  'database',current_database(),
  'publicTables',(select coalesce(jsonb_agg(tablename order by tablename),'[]') from pg_tables where schemaname='public'),
  'tables',jsonb_build_array(${inventory.join(",")}),
  'ledger',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'hash',hash,'createdAt',created_at::text) order by id),'[]') from drizzle.__drizzle_migrations),
  'settings',(select jsonb_agg(x order by x->>'relation') from (
    select jsonb_build_object('relation','certificate_settings','record',to_jsonb(t)) x from public.certificate_settings t
    union all select jsonb_build_object('relation','attendance_settings','record',to_jsonb(t)) from public.attendance_settings t
    union all select jsonb_build_object('relation','registration_settings','record',to_jsonb(t)) from public.registration_settings t
  ) q),
  'columns',(select jsonb_agg(jsonb_build_object('relation',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'defaultExpression',pg_get_expr(d.adbin,d.adrelid)) order by c.relname,a.attnum)
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped),
  'foreignKeys',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',con.conname,'referencedSchema',rn.nspname,'referencedRelation',rc.relname,'definition',pg_get_constraintdef(con.oid)) order by n.nspname,c.relname,con.conname)
    from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_class rc on rc.oid=con.confrelid join pg_namespace rn on rn.oid=rc.relnamespace
    where con.contype='f' and (n.nspname='public' or rn.nspname='public')),
  'triggers',(select jsonb_agg(jsonb_build_object('relation',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),'functionDefinition',pg_get_functiondef(t.tgfoid)) order by c.relname,t.tgname)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal),
  'accounts',(select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'status',u.status,'provider',u.auth_primary_provider,'hasAuthLink',u.auth_user_id is not null,'roles',(select coalesce(jsonb_agg(role_code order by role_code),'[]') from public.user_roles r where r.user_id=u.id)) order by u.id) from public.users u),
  'buckets',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'public',public,'fileSizeLimit',file_size_limit,'allowedMimeTypes',allowed_mime_types) order by id),'[]') from storage.buckets),
  'objects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket',bucket_id,'name',name,'metadata',metadata,'createdAt',created_at,'updatedAt',updated_at) order by bucket_id,name),'[]') from storage.objects)
) as inventory;
rollback;`;
}

export interface NativeInventory {
  readonly mode: string;
  readonly hashScheme: string;
  readonly database: string;
  readonly publicTables: readonly string[];
  readonly tables: readonly {
    table: string;
    classification: string;
    count: number;
    fullRowsSha256: string;
    primaryKeys: readonly Record<string, unknown>[];
  }[];
  readonly ledger: readonly { id: number; hash: string; createdAt: string }[];
  readonly objects: readonly { id: string; bucket: string; name: string }[];
  readonly buckets: readonly { id: string; public: boolean }[];
  readonly columns: readonly Record<string, unknown>[];
  readonly settings: readonly {
    relation: string;
    record: Record<string, unknown>;
  }[];
  readonly accounts: readonly Record<string, unknown>[];
  readonly triggers: readonly {
    relation: string;
    name: string;
    definition: string;
  }[];
  readonly foreignKeys: readonly {
    schema: string;
    relation: string;
    referencedSchema: string;
    referencedRelation: string;
  }[];
}

export function readNativeInventory(output: unknown): NativeInventory {
  if (!output || typeof output !== "object" || !("rows" in output))
    throw new Error("Native inventory response unavailable");
  const rows = output.rows;
  if (!Array.isArray(rows) || rows.length !== 1)
    throw new Error("Native inventory must return exactly one row");
  const row: unknown = rows[0];
  if (!row || typeof row !== "object" || !("inventory" in row))
    throw new Error("Native inventory payload unavailable");
  const inventory: unknown = row.inventory;
  if (
    !inventory ||
    typeof inventory !== "object" ||
    !("mode" in inventory) ||
    inventory.mode !== "READ_ONLY_INVENTORY_NOT_APPLYABLE" ||
    !("database" in inventory) ||
    inventory.database !== "postgres" ||
    !("publicTables" in inventory) ||
    !Array.isArray(inventory.publicTables) ||
    inventory.publicTables.length !== tables.length ||
    inventory.publicTables.some((name, index) => name !== tables[index]) ||
    !("tables" in inventory) ||
    !Array.isArray(inventory.tables) ||
    inventory.tables.length !== tables.length ||
    !("ledger" in inventory) ||
    !Array.isArray(inventory.ledger) ||
    !("objects" in inventory) ||
    !Array.isArray(inventory.objects) ||
    !("hashScheme" in inventory) ||
    inventory.hashScheme !== "postgres-jsonb-sha256-v1" ||
    !("buckets" in inventory) ||
    !Array.isArray(inventory.buckets) ||
    !("columns" in inventory) ||
    !Array.isArray(inventory.columns) ||
    !("triggers" in inventory) ||
    !Array.isArray(inventory.triggers) ||
    !("foreignKeys" in inventory) ||
    !Array.isArray(inventory.foreignKeys) ||
    !("accounts" in inventory) ||
    !Array.isArray(inventory.accounts) ||
    !("settings" in inventory) ||
    !Array.isArray(inventory.settings)
  )
    throw new Error(
      "Native schema inventory changed; review exact scope first",
    );
  for (const entry of inventory.tables as unknown[]) {
    const value =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null;
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.table !== "string" ||
      !tables.some((table) => table === value.table) ||
      typeof value.count !== "number" ||
      !Number.isSafeInteger(value.count) ||
      value.count < 0 ||
      typeof value.fullRowsSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value.fullRowsSha256) ||
      !Array.isArray(value.primaryKeys) ||
      value.primaryKeys.length !== value.count
    )
      throw new Error("Native table inventory is incomplete");
  }
  for (const entry of inventory.ledger as unknown[]) {
    const value =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null;
    if (
      !value ||
      typeof value.id !== "number" ||
      !Number.isSafeInteger(value.id) ||
      typeof value.hash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value.hash) ||
      typeof value.createdAt !== "string" ||
      !/^\d+$/u.test(value.createdAt)
    )
      throw new Error("Native ledger inventory incomplete");
  }
  for (const entry of inventory.objects as unknown[]) {
    const value =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null;
    if (
      !value ||
      typeof value.id !== "string" ||
      typeof value.bucket !== "string" ||
      typeof value.name !== "string"
    )
      throw new Error("Native Storage object inventory incomplete");
  }
  for (const entry of inventory.buckets as unknown[]) {
    const value =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null;
    if (
      !value ||
      typeof value.id !== "string" ||
      typeof value.public !== "boolean"
    )
      throw new Error("Native bucket inventory incomplete");
  }
  for (const entry of inventory.triggers as unknown[]) {
    const value =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null;
    if (
      !value ||
      typeof value.relation !== "string" ||
      typeof value.name !== "string" ||
      typeof value.definition !== "string"
    )
      throw new Error("Native trigger inventory incomplete");
  }
  for (const entry of inventory.foreignKeys as unknown[]) {
    const value =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null;
    if (
      !value ||
      ["schema", "relation", "referencedSchema", "referencedRelation"].some(
        (key) => typeof value[key] !== "string",
      )
    )
      throw new Error("Native FK inventory incomplete");
  }
  return inventory as NativeInventory;
}

/** Direct local/managed-test transport uses the SAME JSON/hash contract as the
 * authenticated cloud CLI. No duplicate inventory or hashing implementation. */
export async function captureFullValidationResetInventory(
  client: postgres.Sql,
) {
  return client.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const sql = fullValidationNativeReadSql();
    const start = sql.indexOf("select jsonb_build_object(");
    const end = sql.lastIndexOf(") as inventory;");
    if (start < 0 || end < start)
      throw new Error("Inventory statement unavailable");
    const rows = await tx.unsafe<{ inventory: unknown }[]>(
      sql.slice(start, end + ") as inventory;".length),
    );
    const inventory = readNativeInventory({ rows: Array.from(rows) });
    return { inventory, inventorySha256: fullValidationPlanHash(inventory) };
  });
}

/** Generates a SQL file in the private evidence directory, and reads ONLY. */
export async function captureNativeCloudValidationInventory(
  project: string,
  privateSqlPath: string,
) {
  if (project !== PRODUCTION_PROJECT)
    throw new Error("Explicit canonical production project required");
  await Bun.write(privateSqlPath, fullValidationNativeReadSql());
  const result = spawnSync(
    process.execPath,
    [
      "x",
      "supabase",
      "db",
      "query",
      "--linked",
      "--project-ref",
      project,
      "--output-format",
      "json",
      "--file",
      privateSqlPath,
    ],
    { encoding: "utf8", stdio: "pipe", timeout: 60000 },
  );
  if (result.status !== 0)
    throw new Error("Authenticated native cloud inventory unavailable");
  const inventory = readNativeInventory(JSON.parse(result.stdout) as unknown);
  return { inventory, inventorySha256: fullValidationPlanHash(inventory) };
}
