import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { createInstructorFixture } from "../fixtures/instructors";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { runFinancialDemo } from "../../scripts/financial-demo";
import { runAttendanceDemo } from "../../scripts/attendance-demo";
import {
  completeDemoCalendars,
  planDemoCalendars,
} from "../../scripts/demo-calendars";
import {
  teachers,
  SEED_OWNER,
  renewalPlan,
  formats,
  seedId,
} from "../../scripts/renew-demo-plan";

test("complete only proven seed calendars after existing manifests, preserving cancellations, finance and unowned groups", async () => {
  const connection = createDatabase(getTestSupabaseEnvironment().databaseUrl, {
    max: 1,
  });
  try {
    const db = connection.db;
    const now = new Date("2026-10-05T16:00:00Z");
    const [admin] = await db
      .insert(s.users)
      .values({
        email: "calendar.operator@example.test",
        name: "Operador",
        status: "ACTIVE",
        authUserId: crypto.randomUUID(),
      })
      .returning();
    await db
      .insert(s.userRoles)
      .values({ userId: admin!.id, roleCode: "ADMIN" });
    const actor = { ...admin!, roles: ["ADMIN"] as const };
    const identities = new Set<string>();
    const instructors: string[] = [];
    for (const teacher of teachers) {
      const user = await createInstructorFixture(db);
      identities.add(user.authUserId!);
      instructors.push(user.id);
      await db
        .update(s.users)
        .set({ email: teacher.email })
        .where(eq(s.users.id, user.id));
    }
    const options = {
      actorId: actor.id,
      now,
      anchorDay: "2026-10-05",
      apply: true,
      identities: {
        async verify(id: string, owner?: string) {
          return owner === SEED_OWNER
            ? identities.has(id)
            : id === actor.authUserId;
        },
      },
    };
    const financial = await runFinancialDemo(db, options);
    await db.transaction((tx) => runAttendanceDemo(tx, actor, financial, true));
    for (const format of formats) {
      await db
        .insert(s.courseTypes)
        .values({ id: format.id, name: format.name });
      await db.insert(s.courseTypeRevisions).values({
        ...format,
        id: seedId(`revision:${format.id}`),
        courseTypeId: format.id,
        revisionNumber: 1,
      });
    }
    for (const sample of renewalPlan(now)) {
      await db.insert(s.courses).values({
        ...sample.course,
        instructorId: instructors[sample.teacher],
      });
      await db.insert(s.groups).values(sample.groups);
      await db.insert(s.auditEvents).values({
        id: seedId(`audit:${sample.course.id}`),
        actorId: actor.id,
        entityType: "COURSE",
        entityId: sample.course.id,
        action: "DEMO_SEEDED",
        metadata: { seedOwner: SEED_OWNER },
      });
    }
    const [foreignCourse] = await db
      .insert(s.courses)
      .values({
        ...renewalPlan(now)[0]!.course,
        id: crypto.randomUUID(),
        slug: "cursillo",
        featured: false,
        instructorId: instructors[0],
      })
      .returning();
    const [foreignGroup] = await db
      .insert(s.groups)
      .values({
        ...renewalPlan(now)[0]!.groups[0]!,
        id: crypto.randomUUID(),
        courseId: foreignCourse!.id,
      })
      .returning();
    const sessionsBefore = await db
      .select()
      .from(s.groupSessions)
      .orderBy(s.groupSessions.id);
    const marksBefore = await db.select().from(s.participantAttendance);
    const moneyBefore = await db.select().from(s.registrationLedger);
    const count = async () =>
      Number(
        (await db.execute(sql`select count(*)::int n from group_sessions`))[0]!
          .n,
      );
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      return completeDemoCalendars(tx, actor, false, now);
    });
    expect(plan).toHaveLength(22);
    expect(plan.filter((r) => r.missing)).toHaveLength(20);
    expect(
      plan
        .filter((r) => r.missing)
        .reduce((n, r) => n + r.expectedOriginals, 0),
    ).toBe(254);
    expect(await count()).toBe(28);
    // Existing manifest path must run completion without replaying cash/marks.
    await runFinancialDemo(db, { ...options, attendance: true });
    expect(await count()).toBe(282);
    for (const row of sessionsBefore)
      expect(
        (
          await db
            .select()
            .from(s.groupSessions)
            .where(eq(s.groupSessions.id, row.id))
        )[0],
      ).toEqual(row);
    expect(await db.select().from(s.participantAttendance)).toEqual(
      marksBefore,
    );
    expect(await db.select().from(s.registrationLedger)).toEqual(moneyBefore);
    expect(
      await db
        .select()
        .from(s.groupSessions)
        .where(eq(s.groupSessions.groupId, foreignGroup!.id)),
    ).toHaveLength(0);
    const past = await db
      .select()
      .from(s.groupSessions)
      .where(eq(s.groupSessions.groupId, financial.courses.past!.groupIds[0]!));
    expect(past).toHaveLength(13);
    expect(past.every((r) => r.administrativeReviewRequired)).toBe(true);
    const auditsBefore = await db.select().from(s.auditEvents);
    await runFinancialDemo(db, { ...options, attendance: true });
    expect(await count()).toBe(282);
    expect(await db.select().from(s.auditEvents)).toEqual(auditsBefore);
    // A foreign extra group is quarantined, not implicitly claimed by course.
    await db
      .insert(s.groups)
      .values({ ...renewalPlan(now)[5]!.groups[0]!, id: crypto.randomUUID() });
    await expect(
      db.transaction((tx) => planDemoCalendars(tx, now)),
    ).rejects.toThrow("unexpected group ownership");
    expect(await count()).toBe(282);
  } finally {
    await connection.close();
  }
}, 120000);
