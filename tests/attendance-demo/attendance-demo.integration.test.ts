import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { createInstructorFixture } from "../fixtures/instructors";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { runFinancialDemo } from "../../scripts/financial-demo";
import { runAttendanceDemo } from "../../scripts/attendance-demo";
import { attendanceDemoPlan } from "../../scripts/attendance-demo-plan";
import { teachers, SEED_OWNER } from "../../scripts/renew-demo-plan";
import { DrizzleAttendanceRepository } from "@/server/db/repositories/attendance-repository";
import {
  getAttendanceSession,
  recordAttendance,
} from "@/application/attendance/manage-attendance";

test("isolated extension is atomic, quarantines collisions and preserves finance while recording real attendance scenarios once", async () => {
  const connection = createDatabase(getTestSupabaseEnvironment().databaseUrl, {
    max: 1,
  });
  try {
    const db = connection.db;
    const [admin] = await db
      .insert(s.users)
      .values({
        email: "attendance.operator@example.test",
        name: "Operador sintético",
        status: "ACTIVE",
        authUserId: crypto.randomUUID(),
      })
      .returning();
    await db
      .insert(s.userRoles)
      .values({ userId: admin!.id, roleCode: "ADMIN" });
    const actor = { ...admin!, roles: ["ADMIN"] as const };
    const owned = new Set<string>();
    for (const teacher of teachers) {
      const user = await createInstructorFixture(db);
      owned.add(user.authUserId!);
      await db
        .update(s.users)
        .set({ email: teacher.email })
        .where(eq(s.users.id, user.id));
    }
    const options = {
      actorId: actor.id,
      anchorDay: "2026-10-05",
      now: new Date("2026-10-05T16:00:00Z"),
      apply: false,
      attendance: true,
      identities: {
        async verify(id: string, owner?: string) {
          return owner === SEED_OWNER ? owned.has(id) : id === actor.authUserId;
        },
      },
    };
    const counts = async () =>
      (
        await db.execute(
          sql`select (select count(*)::int from courses) as courses,(select count(*)::int from pre_registrations) as registrations,(select count(*)::int from registration_ledger) as cash,(select count(*)::int from registration_command_receipts) as finance_receipts,(select count(*)::int from group_sessions) as sessions,(select count(*)::int from session_roster) as roster,(select count(*)::int from participant_attendance) as marks,(select count(*)::int from instructor_attendance) as instructor_marks,(select count(*)::int from attendance_command_receipts) as receipts,(select count(*)::int from audit_events) as audit`,
        )
      )[0];
    const empty = await counts();
    await runFinancialDemo(db, options);
    expect(await counts()).toEqual(empty);
    // Exercise first-load financial + attendance composition, then deliberately
    // roll back this test transaction; no cleanup of immutable history needed.
    const rollback = new Error("isolated composition rollback");
    await expect(
      db.transaction(async (tx) => {
        const combined = await runFinancialDemo(tx, {
          ...options,
          apply: true,
        });
        const attendance = await runAttendanceDemo(tx, actor, combined, false);
        expect(attendance?.registrations.flag).toBeDefined();
        expect(await tx.select().from(s.registrationLedger)).toHaveLength(12);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await counts()).toEqual(empty);
    const financial = await runFinancialDemo(db, {
      ...options,
      attendance: false,
      apply: true,
    });
    const before = await counts();
    const settings = await db.select().from(s.attendanceSettings);
    const financeSettings = await db.select().from(s.registrationSettings);
    const finance = await db.select().from(s.registrationLedger);
    const users = await db.select().from(s.users);
    const profiles = await db.select().from(s.instructorProfiles);
    const plan = attendanceDemoPlan(financial, 3);
    await runFinancialDemo(db, options);
    expect(await counts()).toEqual(before);
    const [foreign] = await db
      .insert(s.participants)
      .values({
        ...plan.participants[0]!.participant,
        firstName: "Ficha ajena",
      })
      .returning();
    await expect(
      runFinancialDemo(db, { ...options, apply: true }),
    ).rejects.toThrow("collision");
    expect(
      (
        await db
          .select()
          .from(s.participants)
          .where(eq(s.participants.id, foreign!.id))
      )[0]!.firstName,
    ).toBe("Ficha ajena");
    expect(await counts()).toEqual(before);
    // Remove only the unreferenced, test-owned collision in this isolated DB.
    await db.delete(s.participants).where(eq(s.participants.id, foreign!.id));
    await expect(
      runFinancialDemo(db, {
        ...options,
        apply: true,
        attendancePreview(p) {
          p.participants[3]!.participant.email = "invalid";
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await counts()).toEqual(before);
    expect(await runFinancialDemo(db, { ...options, apply: true })).toEqual(
      financial,
    );
    const context = await db.transaction((tx) =>
      runAttendanceDemo(tx, actor, financial, false),
    );
    expect(context).not.toBeNull();
    const after = await counts();
    expect(after).toMatchObject({
      courses: 5,
      registrations: 15,
      cash: 12,
      sessions: 132,
      marks: 16,
      instructor_marks: 4,
      receipts: 7,
    });
    const repo = new DrizzleAttendanceRepository(db, () => plan.clock);
    const detail = (key: string) =>
      getAttendanceSession(
        repo,
        actor,
        context!.courseId,
        context!.groupIds[0]!,
        context!.sessions[key]!,
      );
    const recorded = await detail("recorded");
    expect(
      recorded.participants.find(
        (p) => p.registrationId === context!.registrations.warning,
      ),
    ).toMatchObject({
      consecutiveAbsences: 3,
      maximumConsecutiveAbsences: 3,
      warning: true,
      academicallyEligible: true,
      attendance: { status: "ABSENT", inferred: false },
    });
    expect(
      recorded.participants.find(
        (p) => p.registrationId === context!.registrations.flag,
      ),
    ).toMatchObject({
      maximumConsecutiveAbsences: 4,
      academicallyEligible: false,
    });
    expect(
      recorded.participants.find(
        (p) => p.registrationId === context!.registrations.present,
      )!.attendance.status,
    ).toBe("PRESENT");
    const first = await detail("original:1");
    expect(
      first.participants.find(
        (p) => p.registrationId === context!.registrations.justified,
      )!.attendance.status,
    ).toBe("EXCUSED");
    expect(first.session.instructorAttendance.status).toBe("EXCUSED");
    expect(
      (await detail("original:2")).session.instructorAttendance.status,
    ).toBe("ABSENT");
    expect(recorded.session.instructorAttendance.status).toBe("PRESENT");
    const pending = await detail("reviewPending");
    expect(pending.session).toMatchObject({
      administrativeReviewRequired: true,
      instructorAttendance: { status: "PENDING", inferred: false },
    });
    expect(pending.reviewCandidates).toHaveLength(4);
    const today = await detail("todayPending");
    expect(today.participants).toHaveLength(4);
    expect(
      today.participants.every(
        (p) => p.attendance.status === "PENDING" && !p.attendance.inferred,
      ),
    ).toBe(true);
    const todayReplacement = await detail("replacement:today");
    expect(todayReplacement.session).toMatchObject({
      civilDate: plan.anchorDay,
      replacementForSessionId: context!.sessions["cancelledOriginal:today"],
    });
    expect(
      Date.parse(todayReplacement.session.endsAt) -
        Date.parse(todayReplacement.session.startsAt),
    ).toBe(90 * 60000);
    const weekend = await detail("replacement:weekend");
    expect(new Date(`${weekend.session.civilDate}T00:00:00Z`).getUTCDay()).toBe(
      6,
    );
    expect((await detail("cancelledOriginal:today")).session.status).toBe(
      "CANCELLED",
    );
    expect((await detail("cancelled")).session.status).toBe("CANCELLED");
    expect(
      await runFinancialDemo(db, {
        ...options,
        apply: true,
        now: new Date("2027-01-01T12:00:00Z"),
      }),
    ).toEqual(financial);
    expect(await counts()).toEqual(after);
    expect(await db.select().from(s.registrationLedger)).toEqual(finance);
    expect(await db.select().from(s.attendanceSettings)).toEqual(settings);
    expect(await db.select().from(s.registrationSettings)).toEqual(
      financeSettings,
    );
    expect(await db.select().from(s.users)).toEqual(users);
    expect(await db.select().from(s.instructorProfiles)).toEqual(profiles);
    // A legitimate later edit is preserved, not silently replayed by demo seed.
    await recordAttendance(repo, actor, {
      requestKey: crypto.randomUUID(),
      courseId: context!.courseId,
      groupId: context!.groupIds[0]!,
      sessionId: today.session.id,
      revision: today.session.revision,
      marks: [
        { registrationId: context!.registrations.present!, status: "PRESENT" },
      ],
    });
    const edited = await counts();
    await expect(
      runFinancialDemo(db, { ...options, apply: true }),
    ).rejects.toThrow("provenance");
    expect(await counts()).toEqual(edited);
    expect(
      (await detail("todayPending")).participants.find(
        (p) => p.registrationId === context!.registrations.present,
      )!.attendance.status,
    ).toBe("PRESENT");
  } finally {
    await connection.close();
  }
}, 120000);
