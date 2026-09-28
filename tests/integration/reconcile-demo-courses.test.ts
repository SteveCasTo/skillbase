import { afterAll, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
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
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import {
  RECONCILIATION,
  runReconciliation,
} from "../../scripts/reconcile-demo-courses";

const url = getTestSupabaseEnvironment().databaseUrl;
const database = createDatabase(url);
afterAll(() => database.close());

test("missing five slugs and nonlocal targets abort without writes", async () => {
  await expect(
    runReconciliation(url, {
      localUrl: url,
      apply: true,
      actorId: crypto.randomUUID(),
      now: new Date("2026-09-27T12:00:00Z"),
    }),
  ).rejects.toThrow("Expected exactly five");
  await expect(
    runReconciliation(url, {
      localUrl: "postgresql://postgres:wrong@127.0.0.1:54322/postgres",
      apply: true,
      actorId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("only the running local");
});

test("preview is read-only; apply backs up full rows, preserves editorial fields, audits and is idempotent", async () => {
  const [format] = await database.db
    .insert(courseTypes)
    .values({ name: `Demo reconciliation ${crypto.randomUUID()}` })
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
      name: "Demo reconciliation actor",
      email: `demo-${crypto.randomUUID()}@test.invalid`,
      status: "ACTIVE",
      authUserId: crypto.randomUUID(),
    })
    .returning();
  await database.db
    .insert(userRoles)
    .values({ userId: actor!.id, roleCode: "ADMIN" });
  const inserted = await database.db
    .insert(courses)
    .values(
      RECONCILIATION.map((sample, index) => ({
        slug: sample.slug,
        name: `Edited locally ${index}`,
        description: "Keep this description",
        contentMarkdown: "Local Markdown",
        artwork: `courses/${crypto.randomUUID()}/artwork.webp`,
        level: "BASIC" as const,
        courseTypeRevisionId: revision!.id,
        instructorName: "Edited teacher",
        schedule: "Legacy schedule",
        conditions: "Keep conditions",
        startsAt: new Date("2026-10-01T04:00:00Z"),
        endsAt: new Date("2026-10-31T03:59:00Z"),
        minimumGrade: 70,
        status: (index === 4 ? "DRAFT" : "PUBLISHED") as "DRAFT" | "PUBLISHED",
        featured: index === 0,
      })),
    )
    .returning();
  // Published groups cannot be deleted after migration 0009. The runner
  // discards this entire isolated database on completion.
  const options = {
    localUrl: url,
    now: new Date("2026-09-27T12:00:00Z"),
    actorId: actor!.id,
  };
  const preview = await runReconciliation(url, { ...options, apply: false });
  expect(preview.applied).toBe(false);
  expect(preview.preview).toHaveLength(5);
  await expect(
    runReconciliation(url, { localUrl: url, apply: true, now: options.now }),
  ).rejects.toThrow("requires --actor-id");
  await expect(
    runReconciliation(url, {
      ...options,
      apply: true,
      actorId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("active local ADMIN");
  expect(
    await database.db
      .select()
      .from(groups)
      .where(
        inArray(
          groups.courseId,
          inserted.map((row) => row.id),
        ),
      ),
  ).toHaveLength(0);
  const applied = await runReconciliation(url, { ...options, apply: true });
  expect(applied.applied).toBe(true);
  expect(applied.backup).toBeTruthy();
  const backup = JSON.parse(await Bun.file(applied.backup!).text()) as {
    courses: typeof inserted;
    revisions: unknown[];
    groups: unknown[];
    auditEvents: unknown[];
  };
  expect(backup.courses).toHaveLength(5);
  expect(backup.courses[0]?.schedule).toBe("Legacy schedule");
  expect(backup.revisions).toHaveLength(1);
  const updated = await database.db
    .select()
    .from(courses)
    .where(
      inArray(
        courses.id,
        inserted.map((row) => row.id),
      ),
    );
  for (const row of updated) {
    const before = inserted.find((item) => item.id === row.id)!;
    expect([
      row.id,
      row.name,
      row.description,
      row.contentMarkdown,
      row.artwork,
      row.status,
      row.featured,
      row.instructorName,
      row.createdAt,
    ]).toEqual([
      before.id,
      before.name,
      before.description,
      before.contentMarkdown,
      before.artwork,
      before.status,
      before.featured,
      before.instructorName,
      before.createdAt,
    ]);
  }
  const createdGroups = await database.db
    .select()
    .from(groups)
    .where(
      inArray(
        groups.courseId,
        inserted.map((row) => row.id),
      ),
    );
  expect(createdGroups).toHaveLength(6);
  for (const group of createdGroups) {
    const course = updated.find((row) => row.id === group.courseId)!;
    expect(group.publishedAt === null).toBe(course.status === "DRAFT");
  }
  const exposed = createdGroups.find((group) => group.publishedAt !== null)!;
  await expect(
    database.db.delete(groups).where(eq(groups.id, exposed.id)).execute(),
  ).rejects.toThrow();
  expect(
    await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "DEMO_COURSE_RECONCILED")),
  ).toHaveLength(5);
  const groupAudits = await database.db
    .select()
    .from(auditEvents)
    .where(
      inArray(
        auditEvents.entityId,
        createdGroups.map((group) => group.id),
      ),
    );
  expect(groupAudits).toHaveLength(6);
  expect(
    groupAudits.every(
      (event) =>
        event.action === "GROUP_CREATED" &&
        event.actorId === actor!.id &&
        createdGroups.some((group) => group.id === event.entityId),
    ),
  ).toBe(true);
  const again = await runReconciliation(url, { ...options, apply: true });
  expect(again.applied).toBe(false);
  expect(
    await database.db
      .select()
      .from(groups)
      .where(
        inArray(
          groups.courseId,
          inserted.map((row) => row.id),
        ),
      ),
  ).toHaveLength(6);
});
