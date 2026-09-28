/** Manual cloud-only operation. Preview and retain the private snapshot before any apply. */
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { courses, courseTypeRevisions } from "@/server/db/schema";
import { RECONCILIATION, planReconciliation } from "./reconcile-demo-courses";

export const PROJECT_REF = "fvzxqlezdrlzykyoevub";
const SLUGS = RECONCILIATION.map(({ slug }) => slug);
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/iu;
const HASH = /^[a-f\d]{64}$/iu;
type Row = Record<string, unknown>;
type Snapshot = {
  courses: Row[];
  revisions: Row[];
  groups: Row[];
  auditEvents: Row[];
  migrationReady: boolean;
};

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

// Embedding arbitrary snapshot text in a dollar-quoted DO block would allow its
// contents to terminate the block. Hex data has no dollar delimiters or SQL syntax.
function jsonSql(value: unknown): string {
  return `convert_from(decode('${Buffer.from(JSON.stringify(value)).toString("hex")}', 'hex'), 'UTF8')::jsonb`;
}

// Exact allowlist is constant, never derived from cloud data or CLI flags.
const allowlist = SLUGS.map(quote).join(", ");
const migrationReady = `EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'published_at') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.groups'::regclass AND tgname = 'groups_protect_published' AND NOT tgisinternal)`;

export const SNAPSHOT_SQL = `SELECT jsonb_build_object(
  'migrationReady', ${migrationReady},
  'courses', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.slug), '[]'::jsonb) FROM public.courses c WHERE c.slug IN (${allowlist})),
  'revisions', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb) FROM public.course_type_revisions r WHERE r.id IN (SELECT course_type_revision_id FROM public.courses WHERE slug IN (${allowlist}))),
  'groups', (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id), '[]'::jsonb) FROM public.groups g WHERE g.course_id IN (SELECT id FROM public.courses WHERE slug IN (${allowlist}))),
  'auditEvents', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::jsonb) FROM public.audit_events a WHERE (a.entity_type = 'COURSE' AND a.entity_id IN (SELECT id FROM public.courses WHERE slug IN (${allowlist}))) OR (a.entity_type = 'GROUP' AND a.entity_id IN (SELECT id FROM public.groups WHERE course_id IN (SELECT id FROM public.courses WHERE slug IN (${allowlist})))))
) AS snapshot`;

function object(value: unknown): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unexpected cloud response shape");
  return value as Row;
}

export function parseSnapshotOutput(output: string): Snapshot {
  const decoded: unknown = JSON.parse(output.trim());
  const rows = Array.isArray(decoded)
    ? decoded
    : (object(decoded).result ?? object(decoded).rows);
  if (!Array.isArray(rows) || rows.length !== 1)
    throw new Error("Expected exactly one snapshot result row");
  const value = object(object(rows[0]).snapshot);
  for (const key of [
    "courses",
    "revisions",
    "groups",
    "auditEvents",
  ] as const) {
    if (
      !Array.isArray(value[key]) ||
      !value[key].every(
        (row: unknown) =>
          row !== null && typeof row === "object" && !Array.isArray(row),
      )
    )
      throw new Error(`Invalid ${key} in snapshot`);
  }
  if (typeof value.migrationReady !== "boolean")
    throw new Error("Migration check absent");
  return value as Snapshot;
}

function date(value: unknown): Date {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("Invalid timestamp in snapshot");
  return new Date(value);
}
function optionalDate(value: unknown): Date | null {
  return value === null ? null : date(value);
}

function sameTimestamp(value: unknown, expected: unknown): boolean {
  if (value === null || expected === null) return value === expected;
  return (
    typeof value === "string" &&
    typeof expected === "string" &&
    Date.parse(value) === Date.parse(expected)
  );
}
function text(row: Row, key: string): string {
  if (typeof row[key] !== "string")
    throw new Error(`Invalid ${key} in snapshot`);
  return row[key];
}

export function previewSnapshot(snapshot: Snapshot, now = new Date()) {
  if (!snapshot.migrationReady)
    throw new Error("Migration 0009 (published_at and trigger) is required");
  if (
    snapshot.courses.length !== SLUGS.length ||
    new Set(snapshot.courses.map((c) => text(c, "slug"))).size !==
      SLUGS.length ||
    snapshot.courses.some(
      (c) => !SLUGS.includes(text(c, "slug") as (typeof SLUGS)[number]),
    )
  )
    throw new Error("Expected exactly five allowlisted courses");
  const plans = snapshot.courses.map((row) => {
    const slug = text(row, "slug");
    const id = text(row, "id");
    if (!UUID.test(id)) throw new Error("Invalid course ID");
    const revision = snapshot.revisions.find(
      (r) => r.id === row.course_type_revision_id,
    );
    if (!revision) throw new Error(`Missing revision for ${slug}`);
    const existing = snapshot.groups.filter((g) => g.course_id === id);
    if (existing.length)
      throw new Error(
        `Existing groups on ${slug}; manual review required (including already applied)`,
      );
    if (row.status !== "DRAFT" && row.status !== "PUBLISHED")
      throw new Error(`Unexpected status for ${slug}`);
    if (
      typeof revision.total_hours !== "number" ||
      typeof revision.session_minutes !== "number"
    )
      throw new Error("Invalid revision terms");
    const course = {
      ...row,
      slug,
      status: row.status,
      courseTypeRevisionId: text(row, "course_type_revision_id"),
      startsAt: date(row.starts_at),
      endsAt: date(row.ends_at),
      registrationStartAt: optionalDate(row.registration_start_at),
      registrationEndAt: optionalDate(row.registration_end_at),
    } as unknown as typeof courses.$inferSelect;
    const terms = {
      id: text(revision, "id"),
      totalHours: revision.total_hours,
      sessionMinutes: revision.session_minutes,
    } as typeof courseTypeRevisions.$inferSelect;
    const plan = planReconciliation(course, terms, now);
    const previous = {
      schedule: row.schedule,
      weekdaysMask: row.weekdays_mask,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      registrationStartAt: row.registration_start_at,
      registrationEndAt: row.registration_end_at,
    };
    const next = {
      schedule: plan.changes.schedule,
      weekdaysMask: plan.changes.weekdaysMask,
      startsAt: plan.changes.startsAt.toISOString(),
      endsAt: plan.changes.endsAt.toISOString(),
      registrationStartAt:
        plan.changes.registrationStartAt?.toISOString() ?? null,
      registrationEndAt: plan.changes.registrationEndAt?.toISOString() ?? null,
    };
    const changedFields = (
      Object.keys(previous) as (keyof typeof previous)[]
    ).filter((key) =>
      key.endsWith("At")
        ? !sameTimestamp(previous[key], next[key])
        : previous[key] !== next[key],
    );
    const calendarEdited = snapshot.auditEvents.some(
      (event) =>
        event.entity_type === "COURSE" &&
        event.entity_id === id &&
        event.action === "COURSE_UPDATED" &&
        typeof object(event.metadata).fields === "string" &&
        /\b(startsAt|endsAt|registrationStartAt|registrationEndAt|weekdaysMask|schedule)\b/u.test(
          object(event.metadata).fields as string,
        ),
    );
    return {
      slug,
      id,
      status: row.status,
      revisionId: terms.id,
      updatedAt: text(row, "updated_at"),
      previous,
      next,
      changedFields,
      calendarEdited,
      groups: plan.groups.map((g) => ({
        capacity: g.capacity,
        startsAt: g.startsAt.toISOString(),
        endsAt: g.endsAt.toISOString(),
      })),
    };
  });
  return plans;
}

export function snapshotHash(snapshot: Snapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function buildApplySql(
  snapshot: Snapshot,
  actorId: string,
  expectedHash: string,
  acceptEditedCalendars: boolean,
  now = new Date(),
): string {
  if (
    !UUID.test(actorId) ||
    !HASH.test(expectedHash) ||
    snapshotHash(snapshot) !== expectedHash
  )
    throw new Error("Invalid actor or snapshot hash");
  const plans = previewSnapshot(snapshot, now);
  if (plans.some((p) => p.calendarEdited) && !acceptEditedCalendars)
    throw new Error(
      "Calendar edits found in audit; --accept-edited-calendars is required",
    );
  const expected = jsonSql(snapshot);
  const planJson = jsonSql(plans);
  // A single DO statement is one atomic transaction via the CLI Management API. All rechecks
  // happen after the same parent locks used by the normal course/group repository.
  return `DO $reconcile$
 DECLARE actual jsonb; item jsonb; planned_group jsonb; new_id uuid; n integer; actor uuid := ${quote(actorId)}::uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(20260915, 3);
  PERFORM pg_advisory_xact_lock(20260915, 1);
  PERFORM id FROM public.courses WHERE slug IN (${allowlist}) ORDER BY slug FOR UPDATE;
  ${SNAPSHOT_SQL.replace(" AS snapshot", " INTO actual")};
  IF actual IS DISTINCT FROM ${expected} THEN RAISE EXCEPTION 'Snapshot changed; aborting'; END IF;
  IF NOT (actual->>'migrationReady')::boolean THEN RAISE EXCEPTION 'Migration 0009 missing'; END IF;
  PERFORM 1 FROM public.users u JOIN public.user_roles ur ON ur.user_id = u.id AND ur.role_code = 'ADMIN' WHERE u.id = actor AND u.status = 'ACTIVE' FOR UPDATE OF u;
  IF NOT FOUND THEN RAISE EXCEPTION 'Actor must be an active ADMIN'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(${planJson}) LOOP
    IF item->>'slug' NOT IN (${allowlist}) THEN RAISE EXCEPTION 'Outside allowlist'; END IF;
    UPDATE public.courses SET schedule = item->'next'->>'schedule', weekdays_mask = (item->'next'->>'weekdaysMask')::integer,
      starts_at = (item->'next'->>'startsAt')::timestamptz, ends_at = (item->'next'->>'endsAt')::timestamptz,
      registration_start_at = (item->'next'->>'registrationStartAt')::timestamptz,
      registration_end_at = (item->'next'->>'registrationEndAt')::timestamptz, updated_at = clock_timestamp()
    WHERE id = (item->>'id')::uuid AND slug = item->>'slug' AND status::text = item->>'status'
      AND course_type_revision_id = (item->>'revisionId')::uuid AND updated_at = (item->>'updatedAt')::timestamptz;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'Course conflict; aborting'; END IF;
    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
      VALUES (actor, 'DEMO_COURSE_RECONCILED', 'COURSE', (item->>'id')::uuid, jsonb_build_object('slug', item->>'slug', 'snapshotHash', ${quote(expectedHash)}));
    FOR planned_group IN SELECT value FROM jsonb_array_elements(item->'groups') LOOP
      INSERT INTO public.groups (course_id, course_type_revision_id, capacity, starts_at, ends_at, published_at)
      VALUES ((item->>'id')::uuid, (item->>'revisionId')::uuid, (planned_group->>'capacity')::integer,
        (planned_group->>'startsAt')::timestamptz, (planned_group->>'endsAt')::timestamptz,
        CASE WHEN item->>'status' = 'PUBLISHED' THEN clock_timestamp() ELSE NULL END) RETURNING id INTO new_id;
      INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
        VALUES (actor, 'GROUP_CREATED', 'GROUP', new_id, jsonb_build_object('capacity', (planned_group->>'capacity')::integer, 'startTime', to_char((planned_group->>'startsAt')::timestamptz AT TIME ZONE 'America/La_Paz', 'HH24:MI'), 'demoReconciliation', true));
    END LOOP;
  END LOOP;
END $reconcile$;`;
}

function privateDirectory(): string {
  const root =
    process.platform === "win32"
      ? join(homedir(), "AppData", "Local", "SkillBase", "reconciliation")
      : join(homedir(), ".local", "share", "skillbase", "reconciliation");
  const directory = resolve(root);
  const workspace = resolve(import.meta.dir, "..");
  if (
    !relative(workspace, directory).startsWith("..") ||
    directory === workspace
  )
    throw new Error("Backup must be outside repository");
  return directory;
}

function restrictBackupDirectory(folder: string): void {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  if (process.platform === "win32") {
    const identity =
      process.env.USERDOMAIN && process.env.USERNAME
        ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
        : null;
    if (!identity)
      throw new Error("Cannot restrict backup ACL without user identity");
    const result = Bun.spawnSync(
      ["icacls", folder, "/inheritance:r", "/grant:r", `${identity}:(OI)(CI)F`],
      { stdout: "ignore", stderr: "ignore" },
    );
    if (result.exitCode !== 0)
      throw new Error("Could not restrict backup directory to current user");
  }
}

async function cloudQuery(sql: string): Promise<string> {
  const folder = mkdtempSync(join(tmpdir(), "skillbase-cloud-query-"));
  const file = join(folder, "query.sql");
  try {
    restrictBackupDirectory(folder);
    writeFileSync(file, sql, { flag: "wx", mode: 0o600 });
    const child = Bun.spawn(
      [
        "bunx",
        "supabase",
        "db",
        "query",
        "--linked",
        "--project-ref",
        PROJECT_REF,
        "--output-format",
        "json",
        "--file",
        file,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    // Never echo CLI stderr: it can contain details of the query, credentials or data.
    void stderr;
    if (exit !== 0)
      throw new Error(
        "Cloud query failed; inspect CLI authentication/linkage privately",
      );
    return stdout;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function parseArgs(args: string[]) {
  if (args.length === 0) return { apply: false as const };
  const flags = new Map<string, string>();
  if (args[0] !== "--apply")
    throw new Error(
      "Use no flags to preview, or --apply with explicit confirmations",
    );
  for (let i = 1; i < args.length; i++) {
    const key = args[i];
    if (key === "--accept-edited-calendars") {
      if (flags.has(key)) throw new Error("Duplicate flag");
      flags.set(key, "true");
      continue;
    }
    if (
      !key ||
      ![
        "--confirm-project-ref",
        "--actor-id",
        "--expected-snapshot-hash",
        "--snapshot",
      ].includes(key) ||
      flags.has(key) ||
      !args[i + 1]
    )
      throw new Error("Invalid or missing apply flag");
    flags.set(key, args[++i]!);
  }
  if (
    flags.get("--confirm-project-ref") !== PROJECT_REF ||
    !UUID.test(flags.get("--actor-id") ?? "") ||
    !HASH.test(flags.get("--expected-snapshot-hash") ?? "") ||
    !flags.has("--snapshot")
  )
    throw new Error(
      "Apply requires project ref, active ADMIN actor UUID, private snapshot path and expected SHA-256",
    );
  return {
    apply: true as const,
    actorId: flags.get("--actor-id")!,
    hash: flags.get("--expected-snapshot-hash")!,
    snapshotPath: flags.get("--snapshot")!,
    acceptEditedCalendars: flags.has("--accept-edited-calendars"),
  };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const linkedRef = readFileSync(
    join(import.meta.dir, "..", "supabase", ".temp", "project-ref"),
    "utf8",
  ).trim();
  if (linkedRef !== PROJECT_REF)
    throw new Error(
      "Linked Supabase project is not the expected production project",
    );
  if (!args.apply) {
    const snapshot = parseSnapshotOutput(await cloudQuery(SNAPSHOT_SQL));
    const plans = previewSnapshot(snapshot);
    const hash = snapshotHash(snapshot);
    const folder = privateDirectory();
    // Recursive mkdir with restrictive permissions; never place backups under the repo.
    restrictBackupDirectory(folder);
    const path = join(
      folder,
      `${new Date().toISOString().replaceAll(":", "-")}-${hash}.json`,
    );
    writeFileSync(path, JSON.stringify(snapshot, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    console.info(
      JSON.stringify(
        {
          projectRef: PROJECT_REF,
          snapshot: path,
          hash,
          preview: plans.map((plan) => ({
            ...plan,
            previous: { ...plan.previous, schedule: "[private: see backup]" },
          })),
        },
        null,
        2,
      ),
    );
    console.info(
      "Read-only preview. Review calendar edits and private backup before apply.",
    );
  } else {
    const folder = privateDirectory();
    const path = resolve(args.snapshotPath);
    if (
      !isAbsolute(args.snapshotPath) ||
      relative(folder, path).startsWith("..") ||
      !existsSync(path)
    )
      throw new Error(
        "Snapshot must be an existing absolute path in the private backup directory",
      );
    const snapshot = object(JSON.parse(readFileSync(path, "utf8"))) as Snapshot;
    const sql = buildApplySql(
      snapshot,
      args.actorId,
      args.hash,
      args.acceptEditedCalendars,
    );
    // Idempotence: if state already matches the plan, exit before any write or audit.
    const live = parseSnapshotOutput(await cloudQuery(SNAPSHOT_SQL));
    if (snapshotHash(live) !== args.hash) {
      const plans = previewSnapshot(snapshot);
      const alreadyApplied = plans.every((p) => {
        const c = live.courses.find((row) => row.id === p.id);
        const actual = live.groups.filter((g) => g.course_id === p.id);
        return (
          c &&
          c.status === p.status &&
          c.course_type_revision_id === p.revisionId &&
          c.schedule === p.next.schedule &&
          c.weekdays_mask === p.next.weekdaysMask &&
          sameTimestamp(c.starts_at, p.next.startsAt) &&
          sameTimestamp(c.ends_at, p.next.endsAt) &&
          sameTimestamp(c.registration_start_at, p.next.registrationStartAt) &&
          sameTimestamp(c.registration_end_at, p.next.registrationEndAt) &&
          live.auditEvents.some(
            (event) =>
              event.entity_type === "COURSE" &&
              event.entity_id === p.id &&
              event.action === "DEMO_COURSE_RECONCILED" &&
              object(event.metadata).snapshotHash === args.hash,
          ) &&
          actual.length === p.groups.length &&
          p.groups.every((g) =>
            actual.some(
              (a) =>
                a.capacity === g.capacity &&
                sameTimestamp(a.starts_at, g.startsAt) &&
                sameTimestamp(a.ends_at, g.endsAt) &&
                a.status === "PLANNED" &&
                a.course_type_revision_id === p.revisionId &&
                (a.published_at !== null) === (p.status === "PUBLISHED"),
            ),
          )
        );
      });
      if (alreadyApplied) {
        console.info("Already applied; no writes or additional audit events.");
        process.exit(0);
      }
      throw new Error(
        "Cloud snapshot differs from backup; preview again before applying",
      );
    }
    await cloudQuery(sql);
    console.info(
      "Applied atomically. Verify with a fresh read-only preview or course admin views.",
    );
  }
}
