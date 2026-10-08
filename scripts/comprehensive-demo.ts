import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { eq, inArray, or, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { requireRoles, resolveActiveUser } from "@/application/auth/authorize";
import type { InternalUser } from "@/domain/auth/types";
import { createPriceSnapshot } from "@/domain/pre-registrations/money";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { DrizzleRegistrationRepository } from "@/server/db/repositories/registration-repository";
import { DrizzleInterestRepository } from "@/server/db/repositories/interest-repository";
import {
  registerInterest,
  mutateInterest,
} from "@/application/interests/manage-interests";
import {
  createRegistration,
  getRegistrationForm,
  recordRegistrationPayment,
  recordRegistrationRefund,
  cancelRegistration,
  transferRegistration,
} from "@/application/pre-registrations/manage-registrations";
import {
  lockInstructorSchedules,
  assertActiveInstructor,
  instructorHasConflict,
} from "@/server/db/repositories/instructor-schedule";
import {
  requireFreshRegistrationActor,
  type RegistrationDatabase,
  type RegistrationTransaction,
} from "@/server/db/repositories/registration-support";
import { provisionComprehensiveAccounts } from "./comprehensive-demo-accounts";
import { seedComprehensiveAcademics } from "./comprehensive-demo-academics";
import {
  COMPREHENSIVE_DEMO_OWNER,
  comprehensiveDemoId,
  comprehensiveDemoPlan,
  assertComprehensiveTarget,
  assertComprehensiveRelease,
  parseComprehensiveArgs,
  type ComprehensiveDemoPlan,
  type ComprehensiveDemoContext,
} from "./comprehensive-demo-plan";
import { currentAnchor, fingerprint } from "./financial-demo-plan";
import { getLocalSupabaseEnvironment } from "./supabase-local-env";

const manifestId = comprehensiveDemoId("manifest");
export interface ComprehensiveDemoOptions {
  actorId: string;
  auth: SupabaseClient;
  password: string;
  apply: boolean;
  anchorDay?: string;
  now?: Date;
  preview?: (plan: ComprehensiveDemoPlan, existing: boolean) => void;
}

async function preflight(
  tx: RegistrationTransaction,
  plan: ComprehensiveDemoPlan,
) {
  // Read the F8 capabilities even in PLAN; never install DDL or repair migration history.
  await tx.select().from(s.academicGroupStates).limit(1);
  await tx.select().from(s.academicClosureVersions).limit(1);
  await tx.select().from(s.academicGroupReopenings).limit(1);
  await tx.select().from(s.academicClosureReceipts).limit(1);
  await tx.select().from(s.adminAccountDeletions).limit(1);
  const hits = await Promise.all([
    tx
      .select({ id: s.courses.id })
      .from(s.courses)
      .where(
        or(
          inArray(
            s.courses.id,
            plan.samples.map((x) => x.course.id),
          ),
          inArray(
            s.courses.slug,
            plan.samples.map((x) => x.course.slug),
          ),
        ),
      ),
    tx
      .select({ id: s.groups.id })
      .from(s.groups)
      .where(
        inArray(
          s.groups.id,
          plan.samples.flatMap((x) => x.groups.map((g) => g.id)),
        ),
      ),
    tx
      .select({ id: s.courseTypes.id })
      .from(s.courseTypes)
      .where(
        or(
          inArray(
            s.courseTypes.id,
            plan.formats.map((f) => f.id),
          ),
          inArray(
            s.courseTypes.name,
            plan.formats.map((f) => f.name),
          ),
        ),
      ),
    tx
      .select({ id: s.courseTypeRevisions.id })
      .from(s.courseTypeRevisions)
      .where(
        inArray(
          s.courseTypeRevisions.id,
          plan.formats.map((f) => comprehensiveDemoId(`revision:${f.id}`)),
        ),
      ),
    tx
      .select({ id: s.participants.id })
      .from(s.participants)
      .where(
        inArray(
          s.participants.ci,
          plan.samples.flatMap((x) =>
            x.registrations.map((r) => r.participant.ci),
          ),
        ),
      ),
    tx
      .select({ id: s.evaluationComponents.id })
      .from(s.evaluationComponents)
      .where(
        inArray(
          s.evaluationComponents.id,
          plan.samples.flatMap((x) => x.components.map((c) => c.id)),
        ),
      ),
  ]);
  if (hits.some((rows) => rows.length))
    throw new Error("Unowned fixture collision; no adoption or repair");
}

async function interests(
  tx: RegistrationTransaction,
  actor: InternalUser,
  plan: ComprehensiveDemoPlan,
) {
  const repo = new DrizzleInterestRepository(tx);
  const sample = plan.samples.find((x) => x.key === "future")!;
  const free = plan.samples.find((x) => x.key === "free")!;
  const converted = sample.registrations.find(
    (r) => r.scenario === "converted",
  )!;
  for (const [i, course] of [sample, free].entries()) {
    for (let n = 0; n < 6; n++) {
      const participant =
        n === 0
          ? converted.participant
          : {
              firstName: ["Ana", "Luis", "Sara", "Pablo", "Eva", "Nicolás"][n]!,
              lastName: "Demo Interés",
              email: `comprehensive.v1.interest.${i}.${n}@example.test`,
              phone: null,
            };
      await registerInterest(repo, course.course.slug, {
        firstName: participant.firstName,
        lastName: participant.lastName,
        email: participant.email,
        phone: participant.phone,
        preferredGroupId:
          n % 3 === 0
            ? null
            : course.groups[n % 2 === 0 && course.key === "future" ? 1 : 0]!.id,
      });
    }
    const [cancelled] = await tx
      .select()
      .from(s.interestRegistrations)
      .where(
        eq(
          s.interestRegistrations.email,
          `comprehensive.v1.interest.${i}.5@example.test`,
        ),
      );
    if (!cancelled) throw new Error("Demo interest missing");
    await mutateInterest(repo, actor, course.course.id, {
      interestRegistrationId: cancelled.id,
      intent: "cancel",
      revision: cancelled.updatedAt.toISOString(),
    });
  }
  const [source] = await tx
    .select()
    .from(s.interestRegistrations)
    .where(eq(s.interestRegistrations.email, converted.participant.email));
  // The same email is deliberately interested in two courses; consume only the selected source.
  const sources = await tx
    .select()
    .from(s.interestRegistrations)
    .where(eq(s.interestRegistrations.email, converted.participant.email));
  if (!source) throw new Error("Demo conversion source missing");
  return sources.find((r) => r.courseId === sample.course.id)!.id;
}

async function createBusinessFixtures(
  tx: RegistrationTransaction,
  actor: InternalUser,
  plan: ComprehensiveDemoPlan,
  accounts: { instructors: string[]; admins: Record<string, string> },
) {
  const context: ComprehensiveDemoContext = {
    owner: COMPREHENSIVE_DEMO_OWNER,
    anchorDay: plan.anchorDay,
    courses: {},
    registrations: {},
    ...accounts,
  };
  for (const format of plan.formats) {
    await tx
      .insert(s.courseTypes)
      .values({ id: format.id, name: format.name, active: format.active });
    await tx.insert(s.courseTypeRevisions).values({
      id: comprehensiveDemoId(`revision:${format.id}`),
      courseTypeId: format.id,
      revisionNumber: 1,
      totalHours: format.totalHours,
      sessionMinutes: format.sessionMinutes,
      studentAmount: format.studentAmount,
      externalAmount: format.externalAmount,
    });
  }
  for (const sample of plan.samples) {
    const instructorId = accounts.instructors[sample.teacher]!;
    await assertActiveInstructor(tx, instructorId, true);
    if (
      await instructorHasConflict(
        tx,
        sample.course.id,
        instructorId,
        sample.groups,
      )
    )
      throw new Error("Demo schedule conflict");
    await tx.insert(s.courses).values({ ...sample.course, instructorId });
    await tx.insert(s.groups).values(sample.groups);
    await tx
      .insert(s.courseInstructorHistory)
      .values({ courseId: sample.course.id, instructorId, actorId: actor.id });
    await tx.insert(s.auditEvents).values({
      id: comprehensiveDemoId(`course-marker:${sample.key}`),
      actorId: actor.id,
      entityType: "COURSE",
      entityId: sample.course.id,
      action: "DEMO_SEEDED",
      metadata: {
        seedOwner: COMPREHENSIVE_DEMO_OWNER,
        anchorDay: plan.anchorDay,
      },
    });
    context.courses[sample.key] = {
      courseId: sample.course.id,
      groupIds: sample.groups.map((g) => g.id),
    };
  }
  const conversionId = await interests(tx, actor, plan);
  for (const sample of plan.samples) {
    if (!sample.registrations.length) continue;
    const repo = new DrizzleRegistrationRepository(
      tx,
      () => sample.fixtureClock,
    );
    const form = await getRegistrationForm(repo, actor, sample.course.id);
    if (!form) throw new Error("Demo registration context missing");
    for (const fixture of sample.registrations) {
      const type =
        fixture.scenario === "external"
          ? "EXTERNAL"
          : fixture.scenario === "auxiliary"
            ? "AUXILIARY"
            : "STUDENT";
      const price = createPriceSnapshot({
        participantType: type,
        courseTypeRevisionId: form.course.courseTypeRevisionId,
        studentAmount: form.course.studentAmount,
        externalAmount: form.course.externalAmount,
        settings: form.settings,
      });
      const total = price.totalPriceCents;
      const partial = ["partial", "completed"].includes(fixture.scenario);
      const amount = partial ? price.minimumPaymentCents : total;
      let row = await createRegistration(
        repo,
        actor,
        {
          requestKey: comprehensiveDemoId(`registration:${fixture.key}`),
          courseId: sample.course.id,
          groupId: sample.groups[0]!.id,
          participant: fixture.participant,
          participantType: type,
          sourceInterestId:
            fixture.scenario === "converted" ? conversionId : null,
          settingsRevision: form.settings.revision,
          courseRevision: form.course.revision,
          firstDayException: false,
          initialPayment: amount
            ? {
                amountCents: amount,
                effectiveDate: null,
                reason: "[DEMO] Efectivo ficticio autorizado",
              }
            : null,
        },
        sample.fixtureClock,
      );
      context.registrations[fixture.key] = row.id;
      if (fixture.scenario === "owed" || fixture.scenario === "refunded") {
        row = (
          await cancelRegistration(
            repo,
            actor,
            {
              requestKey: comprehensiveDemoId(`cancel:${fixture.key}`),
              registrationId: row.id,
              revision: row.revision,
              reason: "[DEMO] Cancelación de inscripción",
              refundedNow: null,
            },
            sample.fixtureClock,
          )
        ).registration;
        if (fixture.scenario === "refunded")
          await recordRegistrationRefund(
            repo,
            actor,
            {
              requestKey: comprehensiveDemoId(`refund:${fixture.key}`),
              registrationId: row.id,
              revision: row.revision,
              cash: {
                amountCents: amount,
                effectiveDate: null,
                reason: "[DEMO] Devolución ficticia registrada",
              },
            },
            sample.fixtureClock,
          );
      }
      if (fixture.scenario === "transfer")
        await transferRegistration(repo, actor, {
          requestKey: comprehensiveDemoId(`transfer:${fixture.key}`),
          registrationId: row.id,
          revision: row.revision,
          destinationGroupId: sample.groups[1]!.id,
        });
      if (fixture.scenario === "completed" && total > amount)
        await recordRegistrationPayment(
          repo,
          actor,
          {
            requestKey: comprehensiveDemoId(`payment:${fixture.key}`),
            registrationId: row.id,
            revision: row.revision,
            cash: {
              amountCents: total - amount,
              effectiveDate: null,
              reason: "[DEMO] Segundo abono ficticio",
            },
          },
          sample.fixtureClock,
        );
    }
  }
  const operator = await resolveActiveUser(
    new DrizzleAuthUserRepository(tx),
    (
      await tx
        .select()
        .from(s.users)
        .where(eq(s.users.id, accounts.admins.operator!))
    )[0]!.authUserId!,
  );
  await seedComprehensiveAcademics(tx, operator, plan, context);
  return context;
}

/** Callers MUST validate the exact DB/API target before opening the connection.
 * PLAN is read-only. Business data is atomic; newly owned Auth accounts may
 * remain after a later business failure and are recovered without rotation. */
export async function runComprehensiveDemo(
  db: RegistrationDatabase,
  options: ComprehensiveDemoOptions,
): Promise<ComprehensiveDemoContext | null> {
  const [admin] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, options.actorId));
  if (!admin?.authUserId) throw new Error("Existing ADMIN required");
  const identity = await options.auth.auth.admin.getUserById(admin.authUserId);
  if (identity.error || !identity.data.user)
    throw new Error("ADMIN Auth identity missing");
  const actor = await resolveActiveUser(
    new DrizzleAuthUserRepository(db),
    admin.authUserId,
  );
  requireRoles(actor, ["ADMIN"]);
  const initial = await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const [marker] = await tx
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, manifestId));
    if (marker) {
      if (
        marker.actorId !== actor.id ||
        marker.action !== "DEMO_SEEDED" ||
        marker.entityType !== "DEMO" ||
        marker.entityId !== manifestId ||
        marker.metadata.seedOwner !== COMPREHENSIVE_DEMO_OWNER
      )
        throw new Error("Demo provenance changed");
      const context: ComprehensiveDemoContext = JSON.parse(
        String(marker.metadata.context),
      );
      if (
        context.owner !== COMPREHENSIVE_DEMO_OWNER ||
        fingerprint(context) !== marker.metadata.contextHash
      )
        throw new Error("Invalid demo context");
      if (options.anchorDay && options.anchorDay !== context.anchorDay)
        throw new Error("Persisted anchor cannot move");
      const plan = comprehensiveDemoPlan(
        context.anchorDay,
        Number(marker.metadata.limit),
        Number(marker.metadata.minimumPaymentPercent),
      );
      if (fingerprint(plan) !== marker.metadata.planHash)
        throw new Error("Demo plan changed");
      options.preview?.(plan, true);
      return { context, plan };
    }
    const [attendance] = await tx
      .select()
      .from(s.attendanceSettings)
      .where(eq(s.attendanceSettings.id, 1));
    const [registration] = await tx
      .select()
      .from(s.registrationSettings)
      .where(eq(s.registrationSettings.id, 1));
    if (!attendance || !registration)
      throw new Error("Existing settings required");
    const anchor = options.anchorDay ?? currentAnchor(options.now);
    if (anchor !== currentAnchor(options.now))
      throw new Error(
        "Initial anchor must be today's Bolivia date; existing anchors never move",
      );
    const plan = comprehensiveDemoPlan(
      anchor,
      attendance.consecutiveAbsenceLimit,
      registration.minimumPaymentPercent,
    );
    await preflight(tx, plan);
    options.preview?.(plan, false);
    return { context: null, plan };
  });
  if (initial.context) return initial.context; // Never replay finance, grading or lifecycle after completion.
  const accounts = await provisionComprehensiveAccounts(
    db,
    options.auth,
    actor,
    options.password,
    options.apply,
  );
  if (!options.apply) return null;
  return db.transaction(async (tx) => {
    await lockInstructorSchedules(tx);
    await requireFreshRegistrationActor(tx, actor.id);
    await tx.execute(sql`select pg_advisory_xact_lock(20260915, 3)`);
    await tx.execute(sql`select pg_advisory_xact_lock(20260915, 1)`);
    const [attendance] = await tx
      .select()
      .from(s.attendanceSettings)
      .where(eq(s.attendanceSettings.id, 1))
      .for("share");
    const [registration] = await tx
      .select()
      .from(s.registrationSettings)
      .where(eq(s.registrationSettings.id, 1))
      .for("share");
    if (
      attendance?.consecutiveAbsenceLimit !== initial.plan.limit ||
      registration?.minimumPaymentPercent !== initial.plan.minimumPaymentPercent
    )
      throw new Error(
        "Settings changed after plan; no business writes committed",
      );
    await preflight(tx, initial.plan);
    const context = await createBusinessFixtures(
      tx,
      actor,
      initial.plan,
      accounts,
    );
    await tx.insert(s.auditEvents).values({
      id: manifestId,
      actorId: actor.id,
      entityType: "DEMO",
      entityId: manifestId,
      action: "DEMO_SEEDED",
      metadata: {
        seedOwner: COMPREHENSIVE_DEMO_OWNER,
        anchorDay: initial.plan.anchorDay,
        limit: initial.plan.limit,
        minimumPaymentPercent: initial.plan.minimumPaymentPercent,
        planHash: fingerprint(initial.plan),
        context: JSON.stringify(context),
        contextHash: fingerprint(context),
      },
    });
    return context;
  });
}

if (import.meta.main) {
  let connection: ReturnType<typeof createDatabase> | undefined;
  try {
    const args = parseComprehensiveArgs(process.argv.slice(2));
    if (process.env.VERCEL || (process.env.CI && args.target !== "qa"))
      throw new Error("Manual operator execution required");
    const url = process.env.DEMO_DATABASE_URL ?? "";
    const api = process.env.DEMO_SUPABASE_URL ?? "";
    assertComprehensiveTarget(
      args.target,
      args.project,
      url,
      api,
      args.allowProduction,
    );
    if (args.target === "production") {
      const git = (argv: string[]) => {
        const result = spawnSync("git", argv, {
          encoding: "utf8",
          stdio: "pipe",
        });
        if (result.status !== 0)
          throw new Error("Release source inspection failed");
        return result.stdout;
      };
      assertComprehensiveRelease(
        git(["branch", "--show-current"]),
        git(["rev-parse", "HEAD"]),
        git(["status", "--porcelain"]),
        process.env.DEMO_APPROVED_RELEASE_SHA ?? "",
      );
    }
    if (args.target === "local") {
      const local = getLocalSupabaseEnvironment();
      if (url !== local.databaseUrl || api !== local.apiUrl)
        throw new Error("Running local target mismatch");
    }
    const key = process.env.DEMO_SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("Privileged Auth credential required");
    connection = createDatabase(url, { max: 1 });
    await runComprehensiveDemo(connection.db, {
      actorId: process.env.DEMO_ADMIN_ID ?? "",
      auth: createClient(api, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      password: process.env.DEMO_ACCOUNT_PASSWORD ?? "",
      apply: args.apply,
      ...(args.anchorDay ? { anchorDay: args.anchorDay } : {}),
      preview(plan, existing) {
        console.info(
          JSON.stringify(
            {
              mode: args.apply ? "APPLY" : "PLAN",
              target: args.target,
              project: args.project,
              owner: plan.owner,
              existing,
              anchorDay: plan.anchorDay,
              formats: plan.formats.length,
              instructors: 4,
              adminsCreated: 5,
              courses: plan.samples.map((x) => ({
                id: x.course.id,
                name: x.course.name,
                status: x.course.status,
                groups: x.groups.length,
                components: x.components.length,
                registrations: x.registrations.length,
              })),
              limit: plan.limit,
              minimumPaymentPercent: plan.minimumPaymentPercent,
              preservesExistingRows: true,
              resetAllowed: false,
              certificatesIncluded: false,
            },
            null,
            2,
          ),
        );
      },
    });
    console.info(
      args.apply
        ? "Owned DEMO fixtures ready; no mail sent or existing credentials changed."
        : "PLAN only; no DB/Auth writes. Review before explicit --apply.",
    );
  } catch {
    console.error(
      "Comprehensive demo refused or failed. Verify exact target/project, explicit production approval, schema through 0022, active ADMIN, password and owned fixture collisions. Internal DB/Auth details and credentials withheld. Do not reset, disable triggers or rotate existing accounts.",
    );
    process.exitCode = 1;
  } finally {
    await connection?.close();
  }
}
