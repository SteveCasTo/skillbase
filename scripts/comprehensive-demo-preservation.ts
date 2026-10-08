import { sql } from "drizzle-orm";
import type { RegistrationDatabase } from "@/server/db/repositories/registration-support";
import { fingerprint } from "./financial-demo-plan";

export interface DemoSnapshot {
  tables: { name: string; rows: { keyHash: string; rowHash: string }[] }[];
  ledger: { id: number; hash: string; createdAt: string }[];
}
/** Read-only, server-hashed evidence. Never fetch raw Auth credentials/session
 * rows into the runner, and never upload this per-row witness as an artifact. */
export async function captureDemoSnapshot(
  db: RegistrationDatabase,
): Promise<DemoSnapshot> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`set transaction isolation level repeatable read read only`,
    );
    await tx.execute(sql`set local statement_timeout = '30s'`);
    const catalog = await tx.execute<{
      schema: string;
      name: string;
      keys: string[];
    }>(
      sql`select n.nspname as schema,c.relname as name,coalesce((select array_agg(a.attname order by k.ord) from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum where i.indrelid=c.oid and i.indisprimary),'{}'::name[]) as keys from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','auth','storage','drizzle') order by n.nspname,c.relname`,
    );
    const tables: DemoSnapshot["tables"] = [];
    for (const table of catalog) {
      const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
      const literal = (v: string) => "'" + v.replaceAll("'", "''") + "'";
      const identity = table.keys.length
        ? `jsonb_build_object(${table.keys.flatMap((k) => [literal(k), `t.${quote(k)}`]).join(",")})`
        : "to_jsonb(t)";
      const rows = await tx.execute<{ keyHash: string; rowHash: string }>(
        sql.raw(
          `select encode(sha256(convert_to((${identity})::text,'UTF8')),'hex') as "keyHash",encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as "rowHash" from ${quote(table.schema)}.${quote(table.name)} t order by 1,2`,
        ),
      );
      tables.push({ name: `${table.schema}.${table.name}`, rows: [...rows] });
    }
    const ledger = await tx.execute<DemoSnapshot["ledger"][number]>(
      sql`select id,hash,created_at::text as "createdAt" from drizzle.__drizzle_migrations order by id`,
    );
    if (ledger.length !== 23)
      throw new Error(
        "Approved demo requires ledger 23; no migration performed",
      );
    return { tables, ledger: [...ledger] };
  });
}
export function demoSnapshotSummary(snapshot: DemoSnapshot) {
  return {
    tables: snapshot.tables.length,
    rows: snapshot.tables.reduce((n, t) => n + t.rows.length, 0),
    ledger: snapshot.ledger.length,
    digest: fingerprint(snapshot),
  };
}
export function assertDemoPreservation(
  before: DemoSnapshot,
  after: DemoSnapshot,
): void {
  if (fingerprint(before.ledger) !== fingerprint(after.ledger))
    throw new Error("Migration ledger changed");
  for (const table of before.tables) {
    const current = after.tables.find((t) => t.name === table.name);
    if (!current) throw new Error("Original table missing");
    const hashes = new Map<string, number>();
    for (const row of current.rows) {
      const key = `${row.keyHash}:${row.rowHash}`;
      hashes.set(key, (hashes.get(key) ?? 0) + 1);
    }
    for (const row of table.rows) {
      const key = `${row.keyHash}:${row.rowHash}`;
      const count = hashes.get(key) ?? 0;
      if (!count)
        throw new Error(
          `Original row missing or changed in ${table.name}; stop for concurrent-activity review, never repair`,
        );
      hashes.set(key, count - 1);
    }
  }
}
export function assertDemoNoChanges(
  before: DemoSnapshot,
  after: DemoSnapshot,
): void {
  if (fingerprint(before) !== fingerprint(after))
    throw new Error(
      "Read-only PLAN or repeated APPLY changed rows; concurrent activity must be reviewed",
    );
}
