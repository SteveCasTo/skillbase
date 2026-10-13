import {
  FULL_VALIDATION_BUSINESS_TABLES,
  FULL_VALIDATION_RETAINED_TABLES,
  fullValidationPlanHash,
} from "./full-validation-reset-plan";
import {
  fullValidationNativeReadSql,
  type NativeInventory,
} from "./full-validation-native-inventory";
import {
  assertApprovedDemoMigrationLedger,
  readApprovedDemoMigrations,
} from "./approved-demo-migration-ledger";

export interface ReviewedBusinessReset {
  readonly mode: "PRE_MIGRATION_DISPOSABLE_BUSINESS_RESET";
  readonly actorId: string;
  readonly operationId: string;
  readonly sourceSha: string;
  readonly target: "local" | "production";
  readonly project: "skillbase" | "fvzxqlezdrlzykyoevub";
  readonly inventory: NativeInventory;
  readonly inventorySha256: string;
}

const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

/** Produces one guarded transaction, NOT a connection or an APPLY endpoint.
 * This exceptional maintenance operation is for the explicitly disposable
 * business dataset. It never disables triggers, uses CASCADE or touches Auth. */
export function fullValidationResetSql(
  plan: ReviewedBusinessReset,
  reviewedPlanSha256: string,
): string {
  if (
    plan.mode !== "PRE_MIGRATION_DISPOSABLE_BUSINESS_RESET" ||
    !uuid.test(plan.actorId) ||
    !uuid.test(plan.operationId) ||
    !/^[a-f0-9]{40}$/u.test(plan.sourceSha) ||
    !(
      (plan.target === "local" && plan.project === "skillbase") ||
      (plan.target === "production" && plan.project === "fvzxqlezdrlzykyoevub")
    ) ||
    fullValidationPlanHash(plan) !== reviewedPlanSha256 ||
    fullValidationPlanHash(plan.inventory) !== plan.inventorySha256 ||
    plan.inventory.hashScheme !== "postgres-jsonb-sha256-v1"
  )
    throw new Error("Exact reviewed reset plan and target required");

  const approved = readApprovedDemoMigrations();
  // The pending name migration rejects old nonempty business rows. Only the
  // known historical 24-entry schema may enter this BEFORE-migration stage.
  // Seeding afterwards requires the complete final source ledger, separately.
  if (plan.inventory.ledger.length !== 24 || approved.length < 24)
    throw new Error("Pre-migration reset requires the exact historical schema");
  assertApprovedDemoMigrationLedger(
    plan.inventory.ledger,
    approved.slice(0, 24),
  );

  const business = new Set<string>(FULL_VALIDATION_BUSINESS_TABLES);
  const retained = new Set<string>(FULL_VALIDATION_RETAINED_TABLES);
  const expected = [...business, ...retained].sort();
  if (
    plan.inventory.publicTables.length !== expected.length ||
    plan.inventory.publicTables.some(
      (name, index) => name !== expected[index],
    ) ||
    plan.inventory.tables.length !== expected.length ||
    new Set(plan.inventory.tables.map(({ table }) => table)).size !==
      expected.length ||
    plan.inventory.tables.some(
      ({ table, classification, count, fullRowsSha256, primaryKeys }) =>
        !expected.includes(table) ||
        classification !== (business.has(table) ? "business" : "retained") ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        !/^[a-f0-9]{64}$/u.test(fullRowsSha256) ||
        primaryKeys.length !== count,
    )
  )
    throw new Error("Reviewed business table inventory incomplete");
  if (
    plan.inventory.foreignKeys.some(
      (fk) =>
        fk.referencedSchema === "public" &&
        business.has(fk.referencedRelation) &&
        (fk.schema !== "public" || !business.has(fk.relation)),
    ) ||
    plan.inventory.triggers.some((trigger) =>
      /TRUNCATE/iu.test(trigger.definition),
    )
  )
    throw new Error(
      "Reset has an unreviewed external dependency or truncate trigger",
    );
  const permittedBuckets = new Set(["certificate-documents", "course-artwork"]);
  if (
    plan.inventory.buckets.some((bucket) => !permittedBuckets.has(bucket.id)) ||
    plan.inventory.objects.some(
      (object) =>
        !permittedBuckets.has(object.bucket) ||
        !object.name ||
        object.name.startsWith("/") ||
        object.name.split("/").includes(".."),
    )
  )
    throw new Error("Reset contains unknown Storage purposes or object paths");

  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const delimiter = `$full_reset_${reviewedPlanSha256}$`;
  if (JSON.stringify(plan).includes(delimiter))
    throw new Error("Reviewed payload conflicts with transaction delimiter");
  // Reuse the exact same READ inventory expression under locks to catch row,
  // column, trigger, FK, ledger, settings, account and object drift atomically.
  const read = fullValidationNativeReadSql();
  const start = read.indexOf("select jsonb_build_object(");
  const end = read.lastIndexOf(") as inventory;");
  if (start < 0 || end < start)
    throw new Error("Inventory expression unavailable");
  const expression = read.slice(start + "select ".length, end + 1);
  const locked = expected.map((table) => `public.${table}`).join(", ");
  const truncated = [...business]
    .sort()
    .map((table) => `public.${table}`)
    .join(", ");
  const fingerprintChecks = plan.inventory.tables
    .filter(({ classification }) => classification === "business")
    .map(
      ({ table }) =>
        `IF EXISTS (SELECT 1 FROM public.${table}) THEN RAISE EXCEPTION 'Business reset incomplete'; END IF;`,
    )
    .join("\n");
  return `BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL standard_conforming_strings = on;
SELECT pg_advisory_xact_lock(20260915, 3);
SELECT pg_advisory_xact_lock(20260915, 1);
LOCK TABLE ${locked} IN ACCESS EXCLUSIVE MODE;
DO ${delimiter}
DECLARE actual jsonb; approved jsonb := ${quote(JSON.stringify(plan.inventory))}::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users u JOIN public.user_roles r ON r.user_id=u.id
    JOIN auth.users a ON a.id=u.auth_user_id
    WHERE u.id=${quote(plan.actorId)}::uuid AND u.status='ACTIVE' AND u.auth_user_id IS NOT NULL
    AND r.role_code='ADMIN' AND (SELECT count(*) FROM public.user_roles own_roles WHERE own_roles.user_id=u.id)=1
    AND a.email_confirmed_at IS NOT NULL AND lower(a.email)=u.email)
    THEN RAISE EXCEPTION 'Existing confirmed linked active ADMIN required'; END IF;
  actual := ${expression};
  IF (actual - 'tables') IS DISTINCT FROM (approved - 'tables')
    OR (SELECT jsonb_agg(t ORDER BY t->>'table') FROM jsonb_array_elements(actual->'tables') t
      WHERE t->>'table' NOT IN ('auth_attempt_buckets','auth_google_link_requests','interest_registration_rate_limits'))
    IS DISTINCT FROM
    (SELECT jsonb_agg(t ORDER BY t->>'table') FROM jsonb_array_elements(approved->'tables') t
      WHERE t->>'table' NOT IN ('auth_attempt_buckets','auth_google_link_requests','interest_registration_rate_limits'))
  THEN RAISE EXCEPTION 'Reviewed reset inventory changed; nothing reset'; END IF;
END ${delimiter};
TRUNCATE TABLE ${truncated} RESTRICT;
DO ${delimiter} BEGIN ${fingerprintChecks} END ${delimiter};
INSERT INTO public.audit_events(id, actor_id, entity_type, entity_id, action, metadata)
VALUES (${quote(plan.operationId)}::uuid, ${quote(plan.actorId)}::uuid, 'BUSINESS_MAINTENANCE',
  ${quote(plan.operationId)}::uuid, 'VALIDATION_BUSINESS_RESET',
  jsonb_build_object('owner','skillbase-validation-v3','reviewedPlanSha256',${quote(reviewedPlanSha256)},
    'inventorySha256',${quote(plan.inventorySha256)},'sourceSha',${quote(plan.sourceSha)},
    'target',${quote(plan.target)},'project',${quote(plan.project)}));
COMMIT;`;
}
