import { afterAll, expect, test } from "bun:test";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  assertCurrentMigrationLedger,
  applicationMigrationsFolder,
  readMigrationLedger,
} from "../fixtures/migration-ledger";

import { createDatabase } from "@/server/db/client";
import {
  auditEvents,
  courses,
  courseTypeRevisions,
  courseTypes,
  groups,
  userRoles,
  users,
} from "@/server/db/schema";
import { eq, inArray } from "drizzle-orm";
import { RECONCILIATION } from "../../scripts/reconcile-demo-courses";
import {
  buildApplySql,
  parseSnapshotOutput,
  previewSnapshot,
  SNAPSHOT_SQL,
  snapshotHash,
} from "../../scripts/reconcile-production-demo-courses";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

const stackUrl = getTestSupabaseEnvironment().databaseUrl;
// The local-reconciliation suite uses these same five immutable slugs. Give the
// real production SQL its own migrated DB inside the disposable Supabase stack.
const name = `reconcile_sql_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(stackUrl, { prepare: false, max: 1 });
await admin.unsafe(`CREATE DATABASE ${name}`);
const connection = new URL(stackUrl);
connection.pathname = `/${name}`;
const url = connection.toString();
const database = createDatabase(url);
const client = postgres(url, { prepare: false, max: 1 });
const now = new Date("2026-09-28T12:00:00Z");

afterAll(async () => {
  await client.end();
  await database.close();
  await admin.unsafe(`DROP DATABASE ${name}`);
  await admin.end();
});

// CREATE DATABASE does not inherit Supabase's provider-owned Storage schema.
// Supply only the external DDL surface consumed by application migrations in
// this named disposable database. This is not a Storage/Auth emulator; real
// private-bucket/API behavior is covered against the managed Supabase stack.
await client.unsafe(`
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (
    id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  CREATE TABLE storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text REFERENCES storage.buckets(id)
  );
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
`);
// Use the real Drizzle migrator, which preserves the underlying PostgreSQL
// error rather than losing a CLI stdout-only diagnostic in an empty stderr.
await migrate(database.db, { migrationsFolder: applicationMigrationsFolder });
await assertCurrentMigrationLedger(database.db);
const migratedLedger = await readMigrationLedger(database.db);
await migrate(database.db, { migrationsFolder: applicationMigrationsFolder });
expect(await readMigrationLedger(database.db)).toEqual(migratedLedger);

async function snapshot() {
  const rows = await client.unsafe(SNAPSHOT_SQL);
  return parseSnapshotOutput(JSON.stringify([{ snapshot: rows[0]?.snapshot }]));
}

test("actual generated SQL applies atomically to five editorial courses, then rejects a stale snapshot", async () => {
  const bucket =
    await client`select public, file_size_limit::text as size, allowed_mime_types from storage.buckets where id = 'certificate-documents'`;
  expect(bucket[0]).toEqual({
    public: false,
    size: "10485760",
    allowed_mime_types: ["application/pdf"],
  });
  const policy =
    await client`select polpermissive from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'certificate_objects_server_only'`;
  expect(policy[0]?.polpermissive).toBe(false);
  const [format] = await database.db
    .insert(courseTypes)
    .values({ name: `Production SQL fixture ${crypto.randomUUID()}` })
    .returning();
  const [revision] = await database.db
    .insert(courseTypeRevisions)
    .values({
      courseTypeId: format!.id,
      revisionNumber: 1,
      totalHours: 20,
      sessionMinutes: 90,
      studentAmount: "80.00",
      externalAmount: "100.00",
    })
    .returning();
  const [actor] = await database.db
    .insert(users)
    .values({
      name: "Synthetic production SQL admin",
      email: `reconcile-sql-${crypto.randomUUID()}@test.invalid`,
      authUserId: crypto.randomUUID(),
      status: "ACTIVE",
    })
    .returning();
  await database.db
    .insert(userRoles)
    .values({ userId: actor!.id, roleCode: "ADMIN" });
  const original = await database.db
    .insert(courses)
    .values(
      RECONCILIATION.map(({ slug }, index) => ({
        slug,
        name: `Editorial name ${index} 'é`,
        description: `Preserve description ${index}`,
        contentMarkdown: `# Markdown ${index}\n**preserved**`,
        artwork: `courses/${crypto.randomUUID()}/artwork.webp`,
        level: "BASIC" as const,
        courseTypeRevisionId: revision!.id,
        instructorName: `Instructor ${index}`,
        conditions: `Conditions ${index}`,
        schedule: "Legacy schedule",
        startsAt: new Date("2026-10-01T04:00:00Z"),
        endsAt: new Date("2026-10-31T03:59:00Z"),
        minimumGrade: 70,
        status: (index === 4 ? "DRAFT" : "PUBLISHED") as "DRAFT" | "PUBLISHED",
        featured: index === 0,
      })),
    )
    .returning();
  const before = await snapshot();
  expect(before.migrationReady).toBe(true);
  expect(before.courses).toHaveLength(5);
  expect(before.revisions).toHaveLength(1);
  expect(before.groups).toHaveLength(0);
  const plans = previewSnapshot(before, now);
  expect(plans.map((plan) => plan.groups.length).sort()).toEqual([
    1, 1, 1, 1, 2,
  ]);
  const hash = snapshotHash(before);
  const sql = buildApplySql(before, actor!.id, hash, false, now);
  await database.db
    .update(courses)
    .set({ schedule: "Tampered after snapshot" })
    .where(eq(courses.id, original[0]!.id));
  await expect(client.begin(async (tx) => tx.unsafe(sql))).rejects.toThrow(
    "Snapshot changed; aborting",
  );
  const ids = original.map((course) => course.id);
  expect(
    await database.db
      .select()
      .from(groups)
      .where(inArray(groups.courseId, ids)),
  ).toHaveLength(0);
  expect(
    await database.db
      .select()
      .from(auditEvents)
      .where(inArray(auditEvents.entityId, ids)),
  ).toHaveLength(0);
  await database.db
    .update(courses)
    .set({ schedule: "Legacy schedule" })
    .where(eq(courses.id, original[0]!.id));
  const fresh = await snapshot();
  await client.begin(async (tx) => {
    await tx.unsafe(
      buildApplySql(fresh, actor!.id, snapshotHash(fresh), false, now),
    );
  });

  const updated = await database.db
    .select()
    .from(courses)
    .where(inArray(courses.id, ids));
  expect(updated).toHaveLength(5);
  for (const row of updated) {
    const previous = original.find((course) => course.id === row.id)!;
    const plan = plans.find((item) => item.id === row.id)!;
    expect({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      contentMarkdown: row.contentMarkdown,
      artwork: row.artwork,
      level: row.level,
      courseTypeRevisionId: row.courseTypeRevisionId,
      instructorName: row.instructorName,
      conditions: row.conditions,
      minimumGrade: row.minimumGrade,
      status: row.status,
      featured: row.featured,
      createdAt: row.createdAt,
    }).toEqual({
      id: previous.id,
      slug: previous.slug,
      name: previous.name,
      description: previous.description,
      contentMarkdown: previous.contentMarkdown,
      artwork: previous.artwork,
      level: previous.level,
      courseTypeRevisionId: previous.courseTypeRevisionId,
      instructorName: previous.instructorName,
      conditions: previous.conditions,
      minimumGrade: previous.minimumGrade,
      status: previous.status,
      featured: previous.featured,
      createdAt: previous.createdAt,
    });
    expect(row.schedule).toBe(plan.next.schedule);
    expect(row.weekdaysMask).toBe(plan.next.weekdaysMask);
    expect(row.startsAt.toISOString()).toBe(plan.next.startsAt);
    expect(row.endsAt.toISOString()).toBe(plan.next.endsAt);
    expect(row.registrationStartAt?.toISOString() ?? null).toBe(
      plan.next.registrationStartAt,
    );
    expect(row.registrationEndAt?.toISOString() ?? null).toBe(
      plan.next.registrationEndAt,
    );
  }
  const created = await database.db
    .select()
    .from(groups)
    .where(inArray(groups.courseId, ids));
  expect(created).toHaveLength(6);
  for (const plan of plans) {
    const actual = created.filter((group) => group.courseId === plan.id);
    expect(actual).toHaveLength(plan.groups.length);
    for (const expected of plan.groups) {
      expect(
        actual.some(
          (group) =>
            group.courseTypeRevisionId === plan.revisionId &&
            group.capacity === expected.capacity &&
            group.startsAt.toISOString() === expected.startsAt &&
            group.endsAt.toISOString() === expected.endsAt &&
            group.status === "PLANNED" &&
            (group.publishedAt !== null) === (plan.status === "PUBLISHED"),
        ),
      ).toBe(true);
    }
  }
  const events = await database.db
    .select()
    .from(auditEvents)
    .where(
      inArray(auditEvents.entityId, [
        ...ids,
        ...created.map((group) => group.id),
      ]),
    );
  expect(
    events.filter((event) => event.action === "DEMO_COURSE_RECONCILED"),
  ).toHaveLength(5);
  expect(
    events.filter((event) => event.action === "GROUP_CREATED"),
  ).toHaveLength(6);
  for (const event of events) {
    expect(event.actorId).toBe(actor!.id);
    if (event.action === "DEMO_COURSE_RECONCILED")
      expect(event.metadata).toMatchObject({
        snapshotHash: snapshotHash(fresh),
      });
    if (event.action === "GROUP_CREATED")
      expect(event.metadata).toMatchObject({ demoReconciliation: true });
  }

  await expect(client.begin(async (tx) => tx.unsafe(sql))).rejects.toThrow(
    "Snapshot changed; aborting",
  );
  expect(
    await database.db
      .select()
      .from(groups)
      .where(inArray(groups.courseId, ids)),
  ).toHaveLength(6);
  expect(
    await database.db
      .select()
      .from(auditEvents)
      .where(
        inArray(auditEvents.entityId, [
          ...ids,
          ...created.map((group) => group.id),
        ]),
      ),
  ).toHaveLength(11);
});
