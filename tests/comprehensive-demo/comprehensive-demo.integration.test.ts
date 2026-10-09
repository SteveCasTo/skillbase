import { expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { runComprehensiveDemo } from "../../scripts/comprehensive-demo";
import {
  captureDemoSnapshot,
  assertDemoPreservation,
  assertDemoNoChanges,
} from "../../scripts/comprehensive-demo-preservation";
import { renewDemo } from "../../scripts/renew-demo";
import { runFinancialDemo } from "../../scripts/financial-demo";
import {
  saveEvaluationScheme,
  saveEvaluationRow,
  getCourseEvaluations,
} from "@/application/evaluations/manage-evaluations";
import { resolveActiveUser } from "@/application/auth/authorize";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { DrizzleAttendanceRepository } from "@/server/db/repositories/attendance-repository";
import {
  getAttendanceGroup,
  recordAttendance,
} from "@/application/attendance/manage-attendance";
import {
  comprehensiveDemoId,
  comprehensiveDemoPlan,
  COMPREHENSIVE_DEMO_OWNER,
} from "../../scripts/comprehensive-demo-plan";
import { currentAnchor, fingerprint } from "../../scripts/financial-demo-plan";
import { DrizzleClosureRepository } from "@/server/db/repositories/academic-closure-repository";
import { DrizzleAdminAccountRepository } from "@/server/db/repositories/admin-account-repository";
import { DrizzleEvaluationRepository } from "@/server/db/repositories/evaluation-repository";
import { DrizzleRegistrationRepository } from "@/server/db/repositories/registration-repository";
import { DrizzleInterestRepository } from "@/server/db/repositories/interest-repository";

test("real owned Auth/domain fixtures fill F8, preserve every original row, remain idempotent and retain edits", async () => {
  const environment = getTestSupabaseEnvironment();
  const connection = createDatabase(environment.databaseUrl, { max: 1 });
  const auth = createClient(environment.apiUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const db = connection.db;
    const identity = await auth.auth.admin.createUser({
      email: "comprehensive.original.operator@example.test",
      password: "QA-only-fixture-password-123!",
      email_confirm: true,
    });
    if (identity.error) throw identity.error;
    const [actor] = await db
      .insert(s.users)
      .values({
        email: identity.data.user.email!,
        name: "Original QA operator",
        status: "ACTIVE",
        authPrimaryProvider: "EMAIL",
        authUserId: identity.data.user.id,
      })
      .returning();
    await db
      .insert(s.userRoles)
      .values({ userId: actor!.id, roleCode: "ADMIN" });
    await db.insert(s.participants).values({
      ci: "ORIGINAL-QA-PRESERVE",
      firstName: "Original",
      lastName: "Fixture",
      email: "original.fixture@example.test",
    });
    await renewDemo(
      db,
      environment,
      actor!.id,
      "QA-only-fixture-password-123!",
      false,
    );
    const oldFinancial = await runFinancialDemo(db, {
      actorId: actor!.id,
      apply: true,
      identities: {
        async verify(id, owner) {
          const result = await auth.auth.admin.getUserById(id);
          return (
            !result.error &&
            !!result.data.user &&
            (!owner || result.data.user.app_metadata.seed_owner === owner)
          );
        },
      },
    });
    const originalActor = await resolveActiveUser(
      new DrizzleAuthUserRepository(db),
      actor!.authUserId!,
    );
    const originalEvaluations = new DrizzleEvaluationRepository(db);
    const oldCourse = oldFinancial.courses.past!.courseId;
    const originalAttendance = new DrizzleAttendanceRepository(db);
    const originalCalendar = await getAttendanceGroup(
      originalAttendance,
      originalActor,
      oldCourse,
      oldFinancial.courses.past!.groupIds[0]!,
    );
    const originalSession = originalCalendar.sessions[0]!;
    await recordAttendance(originalAttendance, originalActor, {
      requestKey: crypto.randomUUID(),
      courseId: oldCourse,
      groupId: oldFinancial.courses.past!.groupIds[0]!,
      sessionId: originalSession.id,
      revision: originalSession.revision,
      reviewRegistrationIds: [oldFinancial.registrations["past:paid"]!],
      completeAdministrativeReview: true,
      marks: [
        {
          registrationId: oldFinancial.registrations["past:paid"]!,
          status: "PRESENT",
        },
      ],
      instructorStatus: "PRESENT",
    });
    const oldComponent = crypto.randomUUID();
    await saveEvaluationScheme(originalEvaluations, originalActor, {
      courseId: oldCourse,
      requestKey: crypto.randomUUID(),
      schemeRevision: 0,
      components: [
        {
          id: oldComponent,
          name: "Original QA immutable scheme",
          type: "THEORY",
          weight: "100.00",
        },
      ],
    });
    const originalRoster = await getCourseEvaluations(
      originalEvaluations,
      originalActor,
      oldCourse,
    );
    await saveEvaluationRow(originalEvaluations, originalActor, {
      courseId: oldCourse,
      requestKey: crypto.randomUUID(),
      schemeRevision: originalRoster.scheme.revision,
      registrationId: oldFinancial.registrations["past:paid"]!,
      grades: [{ componentId: oldComponent, gradeRevision: 0, score: "87.65" }],
    });
    const storage = await auth.storage.createBucket("qa-original-preserve", {
      public: false,
    });
    if (storage.error) throw storage.error;
    const upload = await auth.storage
      .from("qa-original-preserve")
      .upload("synthetic.txt", "Original synthetic QA object", {
        contentType: "text/plain",
      });
    if (upload.error) throw upload.error;
    const sessionClient = createClient(
      environment.apiUrl,
      environment.publishableKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signedIn = await sessionClient.auth.signInWithPassword({
      email: actor!.email,
      password: "QA-only-fixture-password-123!",
    });
    if (signedIn.error) throw signedIn.error;
    // The production snapshot validates the full ledger against the approved
    // checkout journal and SQL hashes, not a hardcoded historical count.
    const hashedOriginal = await captureDemoSnapshot(db);
    const originalBusinessCounts = {
      courses: (await db.select().from(s.courses)).length,
      registrations: (await db.select().from(s.preRegistrations)).length,
      ledger: (await db.select().from(s.registrationLedger)).length,
      grades: (await db.select().from(s.evaluationGrades)).length,
    };
    // Hash every row of every existing table (including Auth/Storage/ledger),
    // without printing secrets. This is QA-only privileged SQL, not production.
    const snapshot = async () => {
      const tables = await db.execute<{ schema: string; table: string }>(
        sql`select table_schema as schema, table_name as table from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','auth','storage','drizzle') order by table_schema, table_name`,
      );
      const result = new Map<string, Set<string>>();
      for (const table of tables) {
        const rows = await db.execute(
          sql`select to_jsonb(t) as row from ${sql.identifier(table.schema)}.${sql.identifier(table.table)} t`,
        );
        result.set(
          `${table.schema}.${table.table}`,
          new Set(rows.map((r) => fingerprint(r.row))),
        );
      }
      return result;
    };
    const preserved = (
      before: Map<string, Set<string>>,
      after: Map<string, Set<string>>,
    ) => {
      for (const [table, hashes] of before)
        for (const hash of hashes)
          expect(
            after.get(table)?.has(hash),
            `original row changed in ${table}`,
          ).toBe(true);
    };
    const before = await snapshot();
    const options = {
      actorId: actor!.id,
      auth,
      password: "QA-only-fixture-password-123!",
      apply: false,
    };
    expect(await runComprehensiveDemo(db, options)).toBeNull();
    expect(await snapshot()).toEqual(before);
    // A mismatched reviewed plan must stop BEFORE provisioning any identity.
    await expect(
      runComprehensiveDemo(db, {
        ...options,
        apply: true,
        expectedPlanHash: "0".repeat(64),
      }),
    ).rejects.toThrow("Reviewed plan changed");
    expect(await snapshot()).toEqual(before);
    // Late graph collision is rejected before any Auth provision.
    const ci = comprehensiveDemoPlan(currentAnchor(), 3, 25).samples.find(
      (x) => x.key === "future",
    )!.registrations[8]!.participant.ci;
    const [collision] = await db
      .insert(s.participants)
      .values({
        ci,
        firstName: "Collision",
        lastName: "QA",
        email: "collision@example.test",
      })
      .returning();
    const withCollision = await snapshot();
    await expect(
      runComprehensiveDemo(db, { ...options, apply: true }),
    ).rejects.toThrow("collision");
    expect(await snapshot()).toEqual(withCollision);
    await db.delete(s.participants).where(eq(s.participants.id, collision!.id));
    // Auth is not a distributed transaction. Fail a late domain operation after
    // provisioning, prove all business rows roll back, then recover those exact
    // owned accounts (no duplicate lifecycle/audit or credential rotation).
    await expect(
      runComprehensiveDemo(db, {
        ...options,
        apply: true,
        preview(plan) {
          plan.samples.find(
            (x) => x.key === "free",
          )!.registrations[1]!.participant.email = "invalid";
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await db.select().from(s.courses)).toHaveLength(
      originalBusinessCounts.courses,
    );
    expect(await db.select().from(s.preRegistrations)).toHaveLength(
      originalBusinessCounts.registrations,
    );
    expect(await db.select().from(s.registrationLedger)).toHaveLength(
      originalBusinessCounts.ledger,
    );
    expect(await db.select().from(s.evaluationGrades)).toHaveLength(
      originalBusinessCounts.grades,
    );
    preserved(before, await snapshot());
    const accountsAfterFailure = await db.select().from(s.users);
    const context = await runComprehensiveDemo(db, { ...options, apply: true });
    expect(context?.owner).toBe(COMPREHENSIVE_DEMO_OWNER);
    expect(Object.keys(context!.courses)).toHaveLength(8);
    expect(Object.keys(context!.registrations)).toHaveLength(26);
    const [pastParticipant] = await db
      .select()
      .from(s.preRegistrations)
      .where(eq(s.preRegistrations.id, context!.registrations["closed:0"]!));
    const [convertedParticipant] = await db
      .select()
      .from(s.preRegistrations)
      .where(eq(s.preRegistrations.id, context!.registrations["future:8"]!));
    expect(convertedParticipant!.participantId).toBe(
      pastParticipant!.participantId,
    );
    expect(context!.instructors).toHaveLength(4);
    const after = await snapshot();
    const hashedAfter = await captureDemoSnapshot(db);
    expect(() =>
      assertDemoPreservation(hashedOriginal, hashedAfter),
    ).not.toThrow();
    expect((await db.select().from(s.users)).map((u) => u.id).sort()).toEqual(
      accountsAfterFailure.map((u) => u.id).sort(),
    );
    for (const table of [
      s.academicGroupStates,
      s.academicClosureVersions,
      s.academicGroupReopenings,
      s.academicClosureReceipts,
      s.adminAccountDeletions,
    ])
      expect((await db.select().from(table)).length).toBeGreaterThan(0);
    preserved(before, after);
    expect(
      await runComprehensiveDemo(db, {
        ...options,
        apply: true,
        now: new Date("2027-05-01T00:00:00Z"),
      }),
    ).toEqual(context);
    expect(await snapshot()).toEqual(after);
    const hashedRepeated = await captureDemoSnapshot(db);
    expect(() =>
      assertDemoNoChanges(hashedAfter, hashedRepeated),
    ).not.toThrow();
    const closure = new DrizzleClosureRepository(db);
    const closed = context!.courses.closed!;
    const state = await closure.getGroup(
      actor!.id,
      closed.courseId,
      closed.groupIds[0]!,
    );
    expect(state.status).toBe("CLOSED");
    expect(state.history).toHaveLength(1);
    const report = state.official!.report;
    expect(report.access).toBe("ADMIN");
    expect(
      report.participants.some(
        (p) => p.result.finalGrade === "0.00" && p.result.status === "COMPLETE",
      ),
    ).toBe(true);
    expect(
      report.participants.some(
        (p) => p.result.finalGrade === "70.00" && p.result.passed,
      ),
    ).toBe(true);
    expect(
      report.participants.some(
        (p) =>
          p.attendance.maximumConsecutiveAbsences === 4 &&
          !p.academicallyPassed &&
          p.result.passed,
      ),
    ).toBe(true);
    // The current source intentionally snapshots INSCRITO only. The overdue
    // registration remains visible in finance but does not block this closure.
    expect(
      report.participants.some(
        (p) => p.registrationId === context!.registrations["closed:6"],
      ),
    ).toBe(false);
    expect(
      (
        await new DrizzleRegistrationRepository(db).detail(
          context!.registrations["closed:6"]!,
          actor!.id,
        )
      )?.registration,
    ).toMatchObject({ membershipStatus: "SALDOVENCIDO", balanceCents: 6000 });
    const reclosed = context!.courses.reclosed!;
    const history = await closure.getGroup(
      actor!.id,
      reclosed.courseId,
      reclosed.groupIds[0]!,
    );
    expect(history.history).toHaveLength(2);
    expect(history.reopenings).toHaveLength(1);
    const v1 = await closure.getVersion(
      actor!.id,
      reclosed.courseId,
      reclosed.groupIds[0]!,
      1,
    );
    const v2 = await closure.getVersion(
      actor!.id,
      reclosed.courseId,
      reclosed.groupIds[0]!,
      2,
    );
    expect(v1.actorName).not.toBe(v2.actorName);
    expect(v1.report).not.toEqual(v2.report);
    expect(
      v1.report.participants.find(
        (p) => p.registrationId === context!.registrations["reclosed:1"],
      )?.result.finalGrade,
    ).toBe("70.00");
    expect(
      v2.report.participants.find(
        (p) => p.registrationId === context!.registrations["reclosed:1"],
      )?.result.finalGrade,
    ).toBe("74.26");
    const pending = context!.courses.pending!;
    const pendingState = await closure.getGroup(
      actor!.id,
      pending.courseId,
      pending.groupIds[0]!,
    );
    expect(pendingState.blockers).toContain("GRADES_PENDING");
    expect(pendingState.blockers).toContain("ATTENDANCE_PENDING");
    expect(pendingState.status).toBe("OPEN");
    const pendingEvaluations = await new DrizzleEvaluationRepository(
      db,
    ).getCourse(actor!.id, pending.courseId, pending.groupIds[0]!);
    expect(pendingEvaluations.scheme.frozenAt).not.toBeNull();
    expect(
      pendingEvaluations.participants.some(
        (p) =>
          p.result.status === "PENDING" &&
          p.grades.some((g) => g.score === "0.00") &&
          p.result.finalGrade === null,
      ),
    ).toBe(true);
    const accounts = new DrizzleAdminAccountRepository(db);
    expect(
      (await accounts.get(actor!.id, context!.admins.unused!))?.action,
    ).toBe("delete");
    expect(
      (await accounts.get(actor!.id, context!.admins.operator!))?.action,
    ).toBe("deactivate");
    expect(
      (await accounts.get(actor!.id, context!.admins.disabled!))?.action,
    ).toBe("activate");
    expect(
      (await accounts.get(actor!.id, context!.admins.reactivated!))?.status,
    ).toBe("ACTIVE");
    const [intent] = await db
      .select()
      .from(s.adminAccountDeletions)
      .where(eq(s.adminAccountDeletions.userId, context!.admins.deleted!));
    expect(intent?.completedAt).not.toBeNull();
    const removed = await auth.auth.admin.getUserById(intent!.authUserId);
    expect(removed.error?.code).toBe("user_not_found");
    const money = new DrizzleRegistrationRepository(db);
    expect(
      (await money.detail(context!.registrations["future:2"]!, actor!.id))
        ?.registration.refundDueCents,
    ).toBe(8000);
    expect(
      (await money.detail(context!.registrations["future:3"]!, actor!.id))
        ?.registration.financialStatus,
    ).toBe("REFUNDED");
    expect(
      (await money.detail(context!.registrations["future:4"]!, actor!.id))
        ?.registration.groupId,
    ).toBe(context!.courses.future!.groupIds[1]);
    expect(
      (await money.detail(context!.registrations["free:0"]!, actor!.id))
        ?.ledger,
    ).toHaveLength(0);
    const interest = new DrizzleInterestRepository(db);
    expect(
      (await interest.course(context!.courses.future!.courseId, "ACTIVE"))
        ?.metrics.activeTotal,
    ).toBe(4);
    expect(
      (await interest.course(context!.courses.free!.courseId, "ACTIVE"))
        ?.metrics.activeTotal,
    ).toBe(5);
    const evaluations = new DrizzleEvaluationRepository(db);
    const roster = await evaluations.getCourse(
      actor!.id,
      closed.courseId,
      closed.groupIds[0]!,
    );
    const person = roster.participants.find(
      (p) => p.membershipStatus === "INSCRITO",
    )!;
    await expect(
      evaluations.saveRow(actor!.id, {
        requestKey: crypto.randomUUID(),
        courseId: closed.courseId,
        groupId: closed.groupIds[0]!,
        schemeRevision: roster.scheme.revision,
        registrationId: person.registrationId,
        grades: [
          {
            componentId: person.grades[0]!.componentId,
            gradeRevision: person.grades[0]!.revision,
            score: "99.00",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "GROUP_CLOSED" });
    // Preserve subsequent manual changes. A rerun does not treat a demo as a reset.
    await db
      .update(s.courses)
      .set({ description: "QA manual edit retained" })
      .where(eq(s.courses.id, pending.courseId));
    const edited = await snapshot();
    await runComprehensiveDemo(db, { ...options, apply: true });
    expect(await snapshot()).toEqual(edited);
    await db
      .update(s.auditEvents)
      .set({ metadata: { seedOwner: "unowned" } })
      .where(eq(s.auditEvents.id, comprehensiveDemoId("manifest")));
    const tampered = await snapshot();
    await expect(
      runComprehensiveDemo(db, { ...options, apply: true }),
    ).rejects.toThrow("provenance");
    expect(await snapshot()).toEqual(tampered);
    console.info(
      JSON.stringify({
        verification: "isolated comprehensive demo",
        originalTables: before.size,
        originalRowsPreserved: [...before.values()].reduce(
          (n, rows) => n + rows.size,
          0,
        ),
        newCourses: 8,
        newGroups: 10,
        newRegistrations: 26,
        newParticipants: 25,
        closureVersions: 3,
        reopenings: 1,
        completedAdminDeletions: 1,
        repeatedApplyChanges: 0,
        canonicalOrCloudWrites: false,
      }),
    );
  } finally {
    await connection.close();
  }
}, 120000);
