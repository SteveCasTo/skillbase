/** Operator-only enrichment of explicitly owned synthetic movements; never a reseed. */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import postgres from "postgres";
import type { PaymentMethod } from "@/domain/pre-registrations/types";
import { assertFinancialTarget } from "./financial-demo-plan";

type Method = PaymentMethod;
interface Movement {
  id: string;
  registrationId: string;
  participantId: string;
  courseId: string;
  identityHash: string;
  identityApproval: "SEED" | "EXPLICIT_TEST";
  ledgerHash: string;
  kind: "PAYMENT" | "REFUND";
  previousMethod: Method | null;
  paymentMethod: Method;
}
export interface PaymentMethodManifest {
  version: "seed-payment-methods-v1";
  target: string;
  project: string;
  movements: Movement[];
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function args() {
  const values = new Map<string, string>();
  const allowed = [
    "--target",
    "--project",
    "--manifest",
    "--reviewed-hash",
    "--approved-identities",
  ];
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i]!;
    if (values.has(key)) throw new Error("Duplicate argument");
    if (key === "--apply" || key === "--allow-production")
      values.set(key, "true");
    else {
      const value = process.argv[++i];
      if (!allowed.includes(key) || !value || value.startsWith("--"))
        throw new Error("Invalid arguments");
      values.set(key, value);
    }
  }
  const target = values.get("--target") ?? "";
  const project = values.get("--project") ?? "";
  const manifest = values.get("--manifest") ?? "";
  const path = resolve(manifest);
  const rel = relative(process.cwd(), path);
  if (
    !manifest ||
    !isAbsolute(manifest) ||
    (!rel.startsWith("..") && !isAbsolute(rel))
  )
    throw new Error("Manifest must be an absolute path outside the repository");
  if (process.env.CI || process.env.VERCEL)
    throw new Error("Manual CLI execution only");
  if (target === "production" && !values.has("--allow-production"))
    throw new Error("Explicit production approval required");
  const databaseUrl =
    process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  assertFinancialTarget(
    target,
    databaseUrl,
    process.env.PUBLIC_SUPABASE_URL ?? "",
    project,
  );
  return {
    target,
    project,
    path,
    databaseUrl,
    apply: values.has("--apply"),
    reviewed: values.get("--reviewed-hash"),
    approvedIdentities: values.get("--approved-identities"),
  };
}
type Sql = ReturnType<typeof postgres>;
interface ApprovedTestIdentity {
  participantId: string;
  courseId: string;
  identityHash: string;
}
async function approvedTestIdentities(
  path?: string,
): Promise<ApprovedTestIdentity[]> {
  if (!path) return [];
  const rel = relative(process.cwd(), resolve(path));
  if (!isAbsolute(path) || (!rel.startsWith("..") && !isAbsolute(rel)))
    throw new Error(
      "Identity approvals must be private and outside the repository",
    );
  const raw: unknown = await Bun.file(path).json();
  if (!Array.isArray(raw))
    throw new Error("Explicit test identity array required");
  return raw.map((entry: unknown) => {
    if (!entry || typeof entry !== "object")
      throw new Error("Invalid identity approval");
    const row = entry as Record<string, unknown>;
    if (
      row.testDataApproved !== true ||
      typeof row.participantId !== "string" ||
      typeof row.courseId !== "string" ||
      typeof row.ci !== "string" ||
      typeof row.email !== "string"
    )
      throw new Error(
        "Exact approved test participant/course/CI/email required",
      );
    return {
      participantId: row.participantId,
      courseId: row.courseId,
      identityHash: hash([row.ci, row.email]),
    };
  });
}
export async function seedPaymentMethodMovements(
  sql: postgres.TransactionSql | Sql,
  approvals: readonly ApprovedTestIdentity[] = [],
): Promise<Movement[]> {
  const rows = await sql<
    {
      id: string;
      registration_id: string;
      participant_id: string;
      course_id: string;
      ci: string;
      email: string;
      owned: boolean;
      kind: "PAYMENT" | "REFUND";
      payment_method: Method | null;
      ledger: Record<string, unknown>;
    }[]
  >`
    select l.id, l.registration_id, r.participant_id, r.course_id,
      p.ci, p.email, l.kind, l.payment_method,
      to_jsonb(l) - 'payment_method' as ledger,
      exists(select 1 from public.audit_events a
        where a.entity_id = r.course_id and a.entity_type = 'COURSE'
          and a.action = 'DEMO_SEEDED'
          and a.metadata->>'seedOwner' in
            ('skillbase-comprehensive-demo-v1', 'skillbase-financial-demo-v1')) as owned
    from public.registration_ledger l
    join public.pre_registrations r on r.id = l.registration_id
    join public.participants p on p.id = r.participant_id
    order by l.id`;
  return rows.map((row) => {
    const synthetic =
      (/^00CDV[12][A-Z0-9]+LP$/u.test(row.ci) &&
        /^comprehensive\.v[12]\.[a-z0-9.-]+@example\.test$/u.test(row.email)) ||
      (/^00FD[0-9]+LP$/u.test(row.ci) &&
        /^finanzas\.v1\.[a-z0-9.-]+@example\.test$/u.test(row.email));
    const seedOwned = row.owned && synthetic;
    const identityHash = hash([row.ci, row.email]);
    const explicitlyApproved = approvals.some(
      (entry) =>
        entry.participantId === row.participant_id &&
        entry.courseId === row.course_id &&
        entry.identityHash === identityHash,
    );
    if (!seedOwned && !explicitlyApproved)
      throw new Error(
        `Unrecognized seed identity for movement ${row.id}; no rows changed`,
      );
    return {
      id: row.id,
      registrationId: row.registration_id,
      participantId: row.participant_id,
      courseId: row.course_id,
      identityHash,
      identityApproval: seedOwned ? "SEED" : "EXPLICIT_TEST",
      ledgerHash: hash(row.ledger),
      kind: row.kind,
      previousMethod: row.payment_method,
      paymentMethod:
        row.payment_method ??
        (parseInt(hash(row.id).slice(0, 2), 16) % 2 === 0 ? "CASH" : "QR"),
    };
  });
}
function summary(manifest: PaymentMethodManifest) {
  return {
    manifestHash: hash(manifest),
    total: manifest.movements.length,
    payments: manifest.movements.filter((m) => m.kind === "PAYMENT").length,
    refunds: manifest.movements.filter((m) => m.kind === "REFUND").length,
    missing: manifest.movements.filter((m) => m.previousMethod === null).length,
    explicitTestMovements: manifest.movements.filter(
      (m) => m.identityApproval === "EXPLICIT_TEST",
    ).length,
    cash: manifest.movements.filter((m) => m.paymentMethod === "CASH").length,
    qr: manifest.movements.filter((m) => m.paymentMethod === "QR").length,
  };
}
export async function main() {
  const options = args();
  const sql = postgres(options.databaseUrl, {
    max: 1,
    prepare: false,
    onnotice() {},
  });
  try {
    if (!options.apply) {
      const approvals = await approvedTestIdentities(
        options.approvedIdentities,
      );
      const manifest: PaymentMethodManifest = await sql.begin(
        "read only",
        async (tx) => ({
          version: "seed-payment-methods-v1",
          target: options.target,
          project: options.project,
          movements: await seedPaymentMethodMovements(tx, approvals),
        }),
      );
      if (await Bun.file(options.path).exists())
        throw new Error("Refusing to overwrite an existing manifest");
      await writeFile(options.path, JSON.stringify(manifest, null, 2), {
        flag: "wx",
        mode: 0o600,
      });
      console.log(JSON.stringify({ mode: "PLAN", ...summary(manifest) }));
      return;
    }
    const manifest = (await Bun.file(
      options.path,
    ).json()) as PaymentMethodManifest;
    if (
      manifest.version !== "seed-payment-methods-v1" ||
      manifest.target !== options.target ||
      manifest.project !== options.project ||
      !/^[a-f0-9]{64}$/u.test(options.reviewed ?? "") ||
      hash(manifest) !== options.reviewed
    )
      throw new Error("Matching reviewed manifest required");
    const updated = await applySeedPaymentMethodManifest(sql, manifest);
    console.log(
      JSON.stringify({ mode: "APPLY", updated, ...summary(manifest) }),
    );
  } finally {
    await sql.end();
  }
}
/** Trusted operator adapter, also exercised only on runner-owned QA databases. */
export async function applySeedPaymentMethodManifest(
  sql: Sql,
  manifest: PaymentMethodManifest,
): Promise<number> {
  return sql.begin(async (tx) => {
    await tx`set local lock_timeout = '5s'`;
    await tx`set local statement_timeout = '60s'`;
    // Exclusive maintenance window. Disable only this exact append-only trigger,
    // transactionally; rollback restores it even if verification/update fails.
    await tx`lock table public.registration_ledger in access exclusive mode`;
    await tx`lock table public.pre_registrations, public.participants, public.audit_events in share mode`;
    const approvals = manifest.movements.filter(
      (entry) => entry.identityApproval === "EXPLICIT_TEST",
    );
    const current = await seedPaymentMethodMovements(tx, approvals);
    if (current.length !== manifest.movements.length)
      throw new Error("Movement set changed; prepare a fresh PLAN");
    const byId = new Map(current.map((m) => [m.id, m]));
    if (new Set(manifest.movements.map((m) => m.id)).size !== current.length)
      throw new Error("Duplicate manifest identity");
    for (const expected of manifest.movements) {
      const actual = byId.get(expected.id);
      if (
        !actual ||
        actual.registrationId !== expected.registrationId ||
        actual.participantId !== expected.participantId ||
        actual.courseId !== expected.courseId ||
        actual.identityHash !== expected.identityHash ||
        actual.identityApproval !== expected.identityApproval ||
        actual.ledgerHash !== expected.ledgerHash ||
        actual.kind !== expected.kind ||
        !["CASH", "QR"].includes(expected.paymentMethod) ||
        (actual.previousMethod !== expected.previousMethod &&
          actual.previousMethod !== expected.paymentMethod)
      )
        throw new Error("Manifest identity/evidence changed; no rows changed");
    }
    const triggers = await tx<
      { tgname: string; tgenabled: string; function_name: string }[]
    >`
        select t.tgname, t.tgenabled, p.proname as function_name from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid = 'public.registration_ledger'::regclass and not t.tgisinternal`;
    if (
      triggers.length !== 2 ||
      !triggers.every((t) => t.tgenabled === "O") ||
      !triggers.some(
        (t) =>
          t.tgname === "registration_ledger_append_only" &&
          t.function_name === "guard_registration_append_only",
      ) ||
      !triggers.some(
        (t) =>
          t.tgname === "registration_ledger_require_payment_method" &&
          t.function_name === "require_registration_payment_method",
      )
    )
      throw new Error("Unexpected ledger guards; maintenance refused");
    await tx`alter table public.registration_ledger disable trigger registration_ledger_append_only`;
    let count = 0;
    for (const entry of manifest.movements) {
      const result =
        await tx`update public.registration_ledger set payment_method = ${entry.paymentMethod}
          where id = ${entry.id}::uuid and payment_method is null`;
      count += result.count;
    }
    await tx`alter table public.registration_ledger enable trigger registration_ledger_append_only`;
    const after = await seedPaymentMethodMovements(tx, approvals);
    if (
      after.some(
        (m) =>
          m.ledgerHash !== byId.get(m.id)?.ledgerHash ||
          m.previousMethod !==
            manifest.movements.find((e) => e.id === m.id)?.paymentMethod,
      )
    )
      throw new Error("Post-write evidence verification failed; rolled back");
    return count;
  });
}
if (import.meta.main) {
  if (process.argv.includes("--help"))
    console.log(
      "PLAN: bun --no-env-file scripts/seed-payment-methods.ts --target local|production --project local|fvzxqlezdrlzykyoevub --manifest <absolute-private-file> [--allow-production] [--approved-identities <private-exact-test-identity-file>]. APPLY: same flags plus --apply --reviewed-hash <PLAN hash>. Environment supplied securely by operator; no reset, migration or seed is executed by this command.",
    );
  else
    await main().catch(() => {
      console.error(
        "Payment-method enrichment refused. Check reviewed seed identities, manifest, exact target and ledger guards. DB details withheld.",
      );
      process.exitCode = 1;
    });
}
