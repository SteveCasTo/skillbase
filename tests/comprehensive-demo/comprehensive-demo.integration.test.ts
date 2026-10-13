import { expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { runComprehensiveDemo } from "../../scripts/comprehensive-demo";
import {
  runRealisticScenarioRefresh,
  captureRefreshChanges,
} from "../../scripts/comprehensive-demo-refresh";
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
import { FULL_VALIDATION_BUSINESS_TABLES } from "../../scripts/full-validation-reset-plan";
import { seedFullValidationBusiness } from "../../scripts/full-validation-business-seed";
import { seedCurrentValidationCertificates } from "../../scripts/full-validation-certificates";
import { defaultCertificateConfiguration } from "@/domain/certificates/rules";
import { DrizzleCertificateRepository } from "@/server/db/repositories/certificate-repository";
import { FULL_VALIDATION_AUTHORITIES } from "../../scripts/full-validation-seed-matrix";
import { seedValidationInvitations } from "../../scripts/full-validation-invitations";
import { prepareFullValidationNamesAndSettings } from "../../scripts/full-validation-prepare";
import {
  seedValidationCoverage,
  validationAccountCoverage,
} from "../../scripts/full-validation-coverage";

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
      paternalSurname: "Fixture",
      maternalSurname: "Quispe",
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
      const result = new Map<string, string[]>();
      for (const table of tables) {
        const rows = await db.execute(
          sql`select to_jsonb(t) as row from ${sql.identifier(table.schema)}.${sql.identifier(table.table)} t`,
        );
        result.set(
          `${table.schema}.${table.table}`,
          rows.map((r) => fingerprint(r.row)).sort(),
        );
      }
      return result;
    };
    const preserved = (
      before: Map<string, string[]>,
      after: Map<string, string[]>,
    ) => {
      for (const [table, hashes] of before) {
        const remaining = new Map<string, number>();
        for (const hash of after.get(table) ?? [])
          remaining.set(hash, (remaining.get(hash) ?? 0) + 1);
        for (const hash of hashes) {
          const count = remaining.get(hash) ?? 0;
          expect(count, `original row changed in ${table}`).toBeGreaterThan(0);
          remaining.set(hash, count - 1);
        }
      }
    };
    const before = await snapshot();
    const options = {
      actorId: actor!.id,
      auth,
      password: "QA-only-fixture-password-123!",
      apply: false,
      sourceVersion: "legacy-v1" as const,
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
        paternalSurname: "QA",
        maternalSurname: "Quispe",
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
    const frozenVersionBefore = await closure.getVersion(
      actor!.id,
      closed.courseId,
      closed.groupIds[0]!,
      1,
    );
    const refreshBefore = await captureDemoSnapshot(db);
    const refreshPlan = await runRealisticScenarioRefresh(db, {
      ...options,
      apply: false,
    });
    // The authored maternal components add 27 edits; the manual description remains retained.
    expect(refreshPlan.edits).toHaveLength(114);
    expect(
      refreshPlan.edits.filter((edit) => edit.field === "maternal_surname"),
    ).toHaveLength(27);
    expect(
      refreshPlan.edits.filter((edit) => edit.table === "instructor_profiles"),
    ).toHaveLength(8);
    expect(
      refreshPlan.edits.some(
        (edit) => edit.table === "courses" && edit.field === "name",
      ),
    ).toBe(true);
    expect(
      refreshPlan.skipped.some(
        (edit) => edit.id === pending.courseId && edit.field === "description",
      ),
    ).toBe(true);
    expect(refreshPlan.additions?.samples).toHaveLength(4);
    assertDemoNoChanges(refreshBefore, await captureDemoSnapshot(db));
    await expect(
      runRealisticScenarioRefresh(db, {
        ...options,
        apply: false,
        primaryAdminEmail: actor!.email,
        confirmedPrimaryAdminId: actor!.id,
      }),
    ).rejects.toThrow("primary GOOGLE ADMIN");
    assertDemoNoChanges(refreshBefore, await captureDemoSnapshot(db));
    await expect(
      runRealisticScenarioRefresh(db, {
        ...options,
        apply: true,
        expectedPlanHash: "0".repeat(64),
      }),
    ).rejects.toThrow("reviewed refresh PLAN");
    assertDemoNoChanges(refreshBefore, await captureDemoSnapshot(db));
    const allowed = await captureRefreshChanges(db, refreshPlan);
    await runRealisticScenarioRefresh(db, {
      ...options,
      apply: true,
      expectedPlanHash: fingerprint(refreshPlan),
    });
    const refreshAfter = await captureDemoSnapshot(db);
    assertDemoPreservation(refreshBefore, refreshAfter, allowed);
    await runRealisticScenarioRefresh(db, {
      ...options,
      apply: true,
      now: new Date("2028-10-11T12:00:00Z"),
    });
    assertDemoNoChanges(refreshAfter, await captureDemoSnapshot(db));
    const versionAfterRefresh = await closure.getVersion(
      actor!.id,
      closed.courseId,
      closed.groupIds[0]!,
      1,
    );
    expect(versionAfterRefresh).toEqual(frozenVersionBefore);
    expect(versionAfterRefresh.report.courseName).toContain("[DEMO]");
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
          (n, rows) => n + rows.length,
          0,
        ),
        newCourses: 12,
        newGroups: 18,
        newRegistrations: 34,
        newParticipants: 33,
        closureVersions: 3,
        reopenings: 1,
        completedAdminDeletions: 1,
        repeatedApplyChanges: 0,
        canonicalOrCloudWrites: false,
      }),
    );
    // Same managed case: after proving insert-only preservation, deliberately
    // reset ONLY this disposable fixture's business relations for the approved
    // full-recreation path. The runtime target was verified by the managed
    // runner above; no Auth/roles/settings/provider rows are truncated.
    const resetId = crypto.randomUUID();
    const retainedRoles = await db.select().from(s.userRoles);
    await db.transaction(async (tx) => {
      await tx.execute(
        sql.raw(
          `TRUNCATE TABLE ${FULL_VALIDATION_BUSINESS_TABLES.map((table) => `public.${table}`).join(", ")} RESTRICT`,
        ),
      );
      await tx.insert(s.auditEvents).values({
        id: resetId,
        actorId: actor!.id,
        entityType: "BUSINESS_MAINTENANCE",
        entityId: resetId,
        action: "VALIDATION_BUSINESS_RESET",
        metadata: { owner: "skillbase-validation-v3", isolatedFixture: true },
      });
    });
    expect(await db.select().from(s.userRoles)).toEqual(retainedRoles);
    const credentialsStillValid = await sessionClient.auth.getUser();
    expect(credentialsStillValid.error).toBeNull();
    const fullOptions = {
      actorId: actor!.id,
      operationId: resetId,
      anchorDay: currentAnchor(),
      accounts: {
        instructors: context!.instructors,
        operatorId: context!.admins.operator!,
      },
      apply: false,
    };
    const fullPlan = await seedFullValidationBusiness(db, auth, fullOptions);
    expect(fullPlan.mode).toBe("PLAN");
    expect(await db.select().from(s.courses)).toHaveLength(0);
    await expect(
      seedFullValidationBusiness(db, auth, {
        ...fullOptions,
        apply: true,
        reviewedPlanSha256: "0".repeat(64),
      }),
    ).rejects.toThrow("plan changed");
    // The preservation half intentionally retains older legacy account labels.
    // Full recreation must refuse those BEFORE any new snapshots are frozen.
    const legacyAccountLabels = (await db.select().from(s.users)).filter(
      (user) =>
        /demo|fictici|ejemplo|sint[eé]tic|fixture|\bQA\b|\bprueba\b/i.test(
          user.name,
        ),
    );
    expect(legacyAccountLabels.length).toBeGreaterThan(0);
    await expect(
      seedFullValidationBusiness(db, auth, {
        ...fullOptions,
        apply: true,
        reviewedPlanSha256: fullPlan.planSha256,
      }),
    ).rejects.toThrow("Remaining old account/profile");
    // Explicit managed-fixture preparation (not a production correction path):
    // preserve UUID/Auth/roles/outbox evidence, supply authored natural labels.
    const retainedPeople = [
      "Daniela Bustos Gallardo",
      "Manuel Rivas Toledo",
      "Claudia Romero Arias",
      "Teresa Vargas Pizarro",
      "Álvaro Rojas Montero",
      "Beatriz Torres Miranda",
    ];
    for (const [index, user] of legacyAccountLabels.entries())
      await db
        .update(s.users)
        .set({ name: retainedPeople[index % retainedPeople.length]! })
        .where(eq(s.users.id, user.id));
    const legacyProfiles = (
      await db.select().from(s.instructorProfiles)
    ).filter((profile) =>
      /demo|fictici|ejemplo|sint[eé]tic|fixture|\bQA\b|\bprueba\b/i.test(
        `${profile.firstName} ${profile.lastName}`,
      ),
    );
    const profileNames = [
      { firstName: "Daniela", lastName: "Bustos Gallardo" },
      { firstName: "Manuel", lastName: "Rivas Toledo" },
      { firstName: "Claudia", lastName: "Romero Arias" },
    ];
    for (const [index, profile] of legacyProfiles.entries()) {
      await db
        .update(s.instructorProfiles)
        .set(profileNames[index % profileNames.length]!)
        .where(eq(s.instructorProfiles.id, profile.id));
      const name = profileNames[index % profileNames.length]!;
      await db
        .update(s.users)
        .set({ name: `${name.firstName} ${name.lastName}` })
        .where(eq(s.users.id, profile.id));
    }
    const fullSeed = await seedFullValidationBusiness(db, auth, {
      ...fullOptions,
      apply: true,
      reviewedPlanSha256: fullPlan.planSha256,
    });
    if (fullSeed.mode !== "APPLIED")
      throw new Error("Expected fresh full validation seed");
    expect(await db.select().from(s.courses)).toHaveLength(12);
    expect(await db.select().from(s.groups)).toHaveLength(18);
    expect(await db.select().from(s.preRegistrations)).toHaveLength(34);
    const fullStudents = await db.select().from(s.participants);
    expect(fullStudents).toHaveLength(33);
    for (const student of fullStudents) {
      expect(student.paternalSurname).toBeTruthy();
      expect(student.maternalSurname).toBeTruthy();
      expect(
        `${student.firstName} ${student.paternalSurname} ${student.maternalSurname}`,
      ).not.toMatch(/demo|fictici|ejemplo/i);
    }
    for (const course of await db.select().from(s.courses))
      expect(
        `${course.name} ${course.slug} ${course.description} ${course.contentMarkdown}`,
      ).not.toMatch(/demo|fictici|ejemplo/i);
    for (const entry of await db.select().from(s.registrationLedger))
      expect(entry.reason ?? "").not.toMatch(/demo|fictici|ejemplo/i);
    for (const version of await db.select().from(s.academicClosureVersions))
      expect(JSON.stringify(version.report)).not.toMatch(
        /demo|fictici|ejemplo/i,
      );
    const invitationOptions = {
      actorId: actor!.id,
      operationId: resetId,
      apply: false,
    };
    const invitePlan = await seedValidationInvitations(
      db,
      auth,
      invitationOptions,
    );
    const inviteSeed = await seedValidationInvitations(db, auth, {
      ...invitationOptions,
      apply: true,
      reviewedPlanSha256: invitePlan.planSha256,
    });
    if (inviteSeed.mode !== "APPLIED")
      throw new Error("Expected internal validation invitations");
    expect(inviteSeed.accounts).toHaveLength(2);
    for (const account of inviteSeed.accounts) {
      const [invited] = await db
        .select()
        .from(s.users)
        .where(eq(s.users.id, account.id));
      expect(invited!.status).toBe("INVITED");
      expect(invited!.authUserId).toBeNull();
    }
    const beforeCoverage = await validationAccountCoverage(db);
    expect(
      beforeCoverage.instructors.some(
        (person) => person.status === "ACTIVE" && person.courseCount === 0,
      ),
    ).toBe(true);
    const disabledTarget = beforeCoverage.instructors.find(
      (person) =>
        person.status === "ACTIVE" &&
        person.courseCount === 0 &&
        !context!.instructors.includes(person.id),
    );
    if (!disabledTarget)
      throw new Error("Managed fixture retained spare instructor missing");
    const [coverageProfile] = await db
      .select()
      .from(s.instructorProfiles)
      .where(eq(s.instructorProfiles.id, disabledTarget.id));
    // Lifecycle uses the instructor PROFILE revision, not a coincident users
    // timestamp. Make them observably different to cover real driver timing.
    await db
      .update(s.users)
      .set({ updatedAt: new Date(coverageProfile!.updatedAt.getTime() + 5000) })
      .where(eq(s.users.id, disabledTarget.id));
    const coverageOptions = {
      actorId: actor!.id,
      operationId: resetId,
      disabledInstructorId: disabledTarget.id,
      apply: false,
    };
    const coveragePlan = await seedValidationCoverage(
      db,
      auth,
      coverageOptions,
    );
    const coverageSeed = await seedValidationCoverage(db, auth, {
      ...coverageOptions,
      apply: true,
      reviewedPlanSha256: coveragePlan.planSha256,
    });
    if (coverageSeed.mode !== "APPLIED")
      throw new Error("Expected real account coverage stage");
    for (const status of ["ACTIVE", "INVITED", "DISABLED"]) {
      expect(
        coverageSeed.coverage.admins.some((person) => person.status === status),
      ).toBe(true);
      expect(
        coverageSeed.coverage.instructors.some(
          (person) => person.status === status,
        ),
      ).toBe(true);
    }
    expect(
      coverageSeed.coverage.instructors.some(
        (person) => person.status === "ACTIVE" && person.courseCount === 0,
      ),
    ).toBe(true);
    const certRepo = new DrizzleCertificateRepository(db);
    const settings = await certRepo.getSettings(actor!.id);
    const cfg = structuredClone(defaultCertificateConfiguration);
    cfg.director = {
      ...cfg.director,
      name: FULL_VALIDATION_AUTHORITIES.director,
    };
    cfg.dean = { ...cfg.dean, name: FULL_VALIDATION_AUTHORITIES.dean };
    cfg.departmentHead = {
      ...cfg.departmentHead,
      name: FULL_VALIDATION_AUTHORITIES.departmentHead,
    };
    await certRepo.updateSettings(actor!.id, settings.revision, cfg);
    const prepOptions = {
      actorId: actor!.id,
      operationId: resetId,
      nameEdits: [],
      apply: false,
    };
    const prepPlan = await prepareFullValidationNamesAndSettings(
      db,
      auth,
      prepOptions,
    );
    await prepareFullValidationNamesAndSettings(db, auth, {
      ...prepOptions,
      apply: true,
      reviewedPlanSha256: prepPlan.planSha256,
    });
    const certificateOptions = {
      actorId: actor!.id,
      operationId: resetId,
      context: fullSeed.context,
      verificationOrigin: "https://example.test",
      apply: false,
    };
    const certPlan = await seedCurrentValidationCertificates(
      db,
      auth,
      certificateOptions,
    );
    const certSeed = await seedCurrentValidationCertificates(db, auth, {
      ...certificateOptions,
      apply: true,
      reviewedPlanSha256: certPlan.planSha256,
      allowSyntheticFinal: true,
    });
    if (certSeed.mode !== "APPLIED")
      throw new Error("Expected current certificate seed");
    expect(certSeed.records.some((c) => c.hasSignedPdf)).toBe(true);
    expect(certSeed.records.some((c) => !c.hasSignedPdf)).toBe(true);
    for (const record of certSeed.records)
      expect(record.templateVersion).toBe("phase9-v2");
    const fullBeforeReplay = await captureDemoSnapshot(db);
    expect(
      (
        await seedFullValidationBusiness(db, auth, {
          ...fullOptions,
          apply: true,
          reviewedPlanSha256: fullPlan.planSha256,
        })
      ).mode,
    ).toBe("NOOP");
    await seedCurrentValidationCertificates(db, auth, {
      ...certificateOptions,
      apply: true,
      reviewedPlanSha256: certPlan.planSha256,
      allowSyntheticFinal: true,
    });
    expect(
      (
        await seedValidationInvitations(db, auth, {
          ...invitationOptions,
          apply: true,
          reviewedPlanSha256: invitePlan.planSha256,
        })
      ).mode,
    ).toBe("NOOP");
    expect(
      (
        await prepareFullValidationNamesAndSettings(db, auth, {
          ...prepOptions,
          apply: true,
          reviewedPlanSha256: prepPlan.planSha256,
        })
      ).mode,
    ).toBe("NOOP");
    expect(
      (
        await seedValidationCoverage(db, auth, {
          ...coverageOptions,
          apply: true,
          reviewedPlanSha256: coveragePlan.planSha256,
        })
      ).mode,
    ).toBe("NOOP");
    assertDemoNoChanges(fullBeforeReplay, await captureDemoSnapshot(db));
  } finally {
    await connection.close();
  }
}, 120000);
