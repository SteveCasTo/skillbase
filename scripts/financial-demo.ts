import { createClient } from "@supabase/supabase-js";
import { asc, eq, inArray, or, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { resolveActiveUser, requireRoles } from "@/application/auth/authorize";
import {
  createRegistration,
  getRegistrationForm,
  cancelRegistration,
  recordRegistrationRefund,
  recordRegistrationPayment,
  transferRegistration,
} from "@/application/pre-registrations/manage-registrations";
import { DrizzleRegistrationRepository } from "@/server/db/repositories/registration-repository";
import {
  assertActiveInstructor,
  instructorHasConflict,
  lockInstructorSchedules,
} from "@/server/db/repositories/instructor-schedule";
import {
  requireFreshRegistrationActor,
  type RegistrationDatabase,
  type RegistrationTransaction,
} from "@/server/db/repositories/registration-support";
import type { InternalUser } from "@/domain/auth/types";
import { SEED_OWNER, teachers } from "./renew-demo-plan";
import { getLocalSupabaseEnvironment } from "./supabase-local-env";
import {
  assertFinancialTarget,
  assertFinancialExecution,
  currentAnchor,
  financialDemoId,
  financialDemoPlan,
  FINANCIAL_DEMO_OWNER,
  fingerprint,
  validateAnchor,
  type FinancialDemoContext,
  type FinancialDemoPlan,
} from "./financial-demo-plan";
import { runAttendanceDemo } from "./attendance-demo";
import { completeDemoCalendars, type DemoCalendarPlan } from "./demo-calendars";
import {
  ATTENDANCE_DEMO_TABLES,
  type AttendanceDemoPlan,
} from "./attendance-demo-plan";

const markerId = financialDemoId("manifest");
export interface FinancialIdentityReader {
  /** Read-only identity verification. Never create accounts or mutate metadata. */
  verify(authId: string, seedOwner?: string): Promise<boolean>;
}
export interface FinancialDemoOptions {
  readonly actorId: string;
  readonly apply: boolean;
  readonly anchorDay?: string;
  readonly now?: Date;
  readonly identities: FinancialIdentityReader;
  readonly preview?: (plan: FinancialDemoPlan, existing: boolean) => void;
  readonly attendance?: boolean;
  readonly calendarsPreview?: (plan: readonly DemoCalendarPlan[]) => void;
  readonly attendancePreview?: (
    plan: AttendanceDemoPlan,
    existing: boolean,
  ) => void;
}
async function stateHash(
  tx: RegistrationTransaction,
  plan: FinancialDemoPlan,
): Promise<string> {
  const courseIds = plan.samples.map((s) => s.course.id);
  const formatIds = plan.formats.map((f) => f.id);
  const registrations = await tx
    .select()
    .from(schema.preRegistrations)
    .where(inArray(schema.preRegistrations.courseId, courseIds))
    .orderBy(asc(schema.preRegistrations.id));
  const ids = registrations.map((r) => r.id);
  const people = registrations.map((r) => r.participantId);
  const receipts = await tx
    .select()
    .from(schema.registrationCommandReceipts)
    .where(
      inArray(schema.registrationCommandReceipts.requestKey, requestKeys(plan)),
    )
    .orderBy(asc(schema.registrationCommandReceipts.id));
  return fingerprint({
    assignments: await tx
      .select()
      .from(schema.courseInstructorHistory)
      .where(inArray(schema.courseInstructorHistory.courseId, courseIds))
      .orderBy(
        asc(schema.courseInstructorHistory.courseId),
        asc(schema.courseInstructorHistory.instructorId),
      ),
    provenance: await tx
      .select()
      .from(schema.auditEvents)
      .where(
        inArray(
          schema.auditEvents.id,
          plan.samples.map((s) => financialDemoId(`audit:${s.key}`)),
        ),
      )
      .orderBy(asc(schema.auditEvents.id)),
    formats: await tx
      .select()
      .from(schema.courseTypes)
      .where(inArray(schema.courseTypes.id, formatIds))
      .orderBy(asc(schema.courseTypes.id)),
    revisions: await tx
      .select()
      .from(schema.courseTypeRevisions)
      .where(inArray(schema.courseTypeRevisions.courseTypeId, formatIds))
      .orderBy(asc(schema.courseTypeRevisions.id)),
    courses: await tx
      .select()
      .from(schema.courses)
      .where(inArray(schema.courses.id, courseIds))
      .orderBy(asc(schema.courses.id)),
    groups: await tx
      .select()
      .from(schema.groups)
      .where(inArray(schema.groups.courseId, courseIds))
      .orderBy(asc(schema.groups.id)),
    registrations,
    participants: people.length
      ? await tx
          .select()
          .from(schema.participants)
          .where(inArray(schema.participants.id, people))
          .orderBy(asc(schema.participants.id))
      : [],
    ledger: ids.length
      ? await tx
          .select()
          .from(schema.registrationLedger)
          .where(inArray(schema.registrationLedger.registrationId, ids))
          .orderBy(asc(schema.registrationLedger.id))
      : [],
    receipts,
  });
}
function requestKeys(plan: FinancialDemoPlan): string[] {
  return plan.samples.flatMap((s) =>
    s.registrations.flatMap((r) =>
      ["create", "cancel", "refund", "transfer", "payment"].map((op) =>
        financialDemoId(`${r.key}:${op}`),
      ),
    ),
  );
}
async function assertNoCollisions(
  tx: RegistrationTransaction,
  plan: FinancialDemoPlan,
): Promise<void> {
  const courseIds = plan.samples.map((s) => s.course.id);
  const groupIds = plan.samples.flatMap((s) => s.groups.map((g) => g.id));
  const cis = plan.samples.flatMap((s) =>
    s.registrations.map((r) => r.participant.ci),
  );
  const hits = await Promise.all([
    tx
      .select({ id: schema.courses.id })
      .from(schema.courses)
      .where(
        or(
          inArray(schema.courses.id, courseIds),
          inArray(
            schema.courses.slug,
            plan.samples.map((s) => s.course.slug),
          ),
        ),
      ),
    tx
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .where(inArray(schema.groups.id, groupIds)),
    tx
      .select({ id: schema.courseTypes.id })
      .from(schema.courseTypes)
      .where(
        or(
          inArray(
            schema.courseTypes.id,
            plan.formats.map((f) => f.id),
          ),
          inArray(
            schema.courseTypes.name,
            plan.formats.map((f) => f.name),
          ),
        ),
      ),
    tx
      .select({ id: schema.courseTypeRevisions.id })
      .from(schema.courseTypeRevisions)
      .where(
        inArray(
          schema.courseTypeRevisions.id,
          plan.samples.map((s) => s.course.courseTypeRevisionId),
        ),
      ),
    tx
      .select({ id: schema.participants.id })
      .from(schema.participants)
      .where(inArray(schema.participants.ci, cis)),
    tx
      .select({ id: schema.registrationCommandReceipts.id })
      .from(schema.registrationCommandReceipts)
      .where(
        inArray(
          schema.registrationCommandReceipts.requestKey,
          requestKeys(plan),
        ),
      ),
    tx
      .select({ id: schema.auditEvents.id })
      .from(schema.auditEvents)
      .where(
        inArray(
          schema.auditEvents.id,
          plan.samples.map((s) => financialDemoId(`audit:${s.key}`)),
        ),
      ),
  ]);
  if (hits.some((rows) => rows.length))
    throw new Error(
      "Unowned fixture collision or incomplete provenance; no writes allowed",
    );
}
async function createFixtures(
  tx: RegistrationTransaction,
  plan: FinancialDemoPlan,
  actor: InternalUser,
  instructors: readonly string[],
): Promise<FinancialDemoContext> {
  const context = {
    owner: FINANCIAL_DEMO_OWNER,
    anchorDay: plan.anchorDay,
    registrations: {} as Record<string, string>,
    courses: {} as Record<string, { courseId: string; groupIds: string[] }>,
  };
  for (const format of plan.formats) {
    await tx
      .insert(schema.courseTypes)
      .values({ id: format.id, name: format.name });
    await tx.insert(schema.courseTypeRevisions).values({
      ...format,
      id: financialDemoId(`revision:${format.id}`),
      courseTypeId: format.id,
      revisionNumber: 1,
    });
  }
  for (const sample of plan.samples) {
    const instructorId = instructors[sample.teacher]!;
    await assertActiveInstructor(tx, instructorId, true);
    if (
      await instructorHasConflict(
        tx,
        sample.course.id,
        instructorId,
        sample.groups,
      )
    )
      throw new Error("Demo instructor schedule conflicts; no rows committed");
    await tx.insert(schema.courses).values({ ...sample.course, instructorId });
    await tx.insert(schema.groups).values(sample.groups);
    await tx
      .insert(schema.courseInstructorHistory)
      .values({ courseId: sample.course.id, instructorId, actorId: actor.id });
    await tx.insert(schema.auditEvents).values({
      id: financialDemoId(`audit:${sample.key}`),
      actorId: actor.id,
      entityType: "COURSE",
      entityId: sample.course.id,
      action: "DEMO_SEEDED",
      metadata: {
        seedOwner: FINANCIAL_DEMO_OWNER,
        anchorDay: plan.anchorDay,
      },
    });
    context.courses[sample.key] = {
      courseId: sample.course.id,
      groupIds: sample.groups.map((g) => g.id),
    };
    // CLI-only trusted fixture clock. Public/server commands retain their real clocks.
    // Nested repository transactions are savepoints within this all-or-nothing seed.
    const repo = new DrizzleRegistrationRepository(
      tx,
      () => sample.fixtureClock,
    );
    const form = await getRegistrationForm(repo, actor, sample.course.id);
    if (!form) throw new Error("Fixture registration context missing");
    for (const fixture of sample.registrations) {
      let registration = await createRegistration(
        repo,
        actor,
        {
          requestKey: financialDemoId(`${fixture.key}:create`),
          courseId: sample.course.id,
          groupId: sample.groups[0]!.id,
          participant: fixture.participant,
          participantType: "STUDENT",
          sourceInterestId: null,
          settingsRevision: form.settings.revision,
          courseRevision: form.course.revision,
          firstDayException: false,
          initialPayment: fixture.amountCents
            ? {
                amountCents: fixture.amountCents,
                effectiveDate: null,
                reason: "Efectivo ficticio de demostración",
              }
            : null,
        },
        sample.fixtureClock,
      );
      context.registrations[fixture.key] = registration.id;
      const mutation = () => ({
        registrationId: registration.id,
        revision: registration.revision,
      });
      if (["owed", "refunded"].includes(fixture.scenario)) {
        registration = (
          await cancelRegistration(
            repo,
            actor,
            {
              ...mutation(),
              requestKey: financialDemoId(`${fixture.key}:cancel`),
              reason: "Cancelación ficticia de demostración",
              refundedNow: null,
            },
            sample.fixtureClock,
          )
        ).registration;
        if (fixture.scenario === "refunded")
          registration = (
            await recordRegistrationRefund(
              repo,
              actor,
              {
                ...mutation(),
                requestKey: financialDemoId(`${fixture.key}:refund`),
                cash: {
                  amountCents: fixture.amountCents,
                  effectiveDate: null,
                  reason: "Devolución ficticia efectivamente registrada",
                },
              },
              sample.fixtureClock,
            )
          ).registration;
      }
      if (fixture.scenario === "transfer")
        registration = await transferRegistration(repo, actor, {
          ...mutation(),
          requestKey: financialDemoId(`${fixture.key}:transfer`),
          destinationGroupId: sample.groups[1]!.id,
        });
      if (fixture.scenario === "completed")
        await recordRegistrationPayment(
          repo,
          actor,
          {
            ...mutation(),
            requestKey: financialDemoId(`${fixture.key}:payment`),
            cash: {
              amountCents: 8000 - fixture.amountCents,
              effectiveDate: null,
              reason: "Saldo ficticio efectivamente registrado",
            },
          },
          sample.fixtureClock,
        );
    }
  }
  return context;
}

/** Caller must verify connection identity before connecting. Tests supply only a runner-owned isolated DB. */
export async function runFinancialDemo(
  db: RegistrationDatabase,
  options: FinancialDemoOptions,
): Promise<FinancialDemoContext> {
  const [admin] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, options.actorId));
  if (
    !admin?.authUserId ||
    !(await options.identities.verify(admin.authUserId))
  )
    throw new Error("Existing ADMIN Auth identity required");
  const actor = await resolveActiveUser(
    new DrizzleAuthUserRepository(db),
    admin.authUserId,
  );
  requireRoles(actor, ["ADMIN"]);
  const instructors: string[] = [];
  for (const teacher of teachers) {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, teacher.email));
    if (
      !user?.authUserId ||
      !(await options.identities.verify(user.authUserId, SEED_OWNER))
    )
      throw new Error(
        "Existing seed-owned instructor identity required; no Auth provisioning performed",
      );
    instructors.push(user.id);
  }
  return db.transaction(async (tx) => {
    if (!options.apply) await tx.execute(sql`set transaction read only`);
    else {
      await lockInstructorSchedules(tx);
      await requireFreshRegistrationActor(tx, actor.id);
    }
    for (const id of instructors) await assertActiveInstructor(tx, id, true);
    // Schema capability check in PLAN as well: 0018 must be applied by the
    // standard migration flow, never silently installed by this runner.
    await tx
      .select({ reason: schema.registrationLedger.reason })
      .from(schema.registrationLedger)
      .limit(1);
    const [marker] = await tx
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.id, markerId));
    const anchorDay = marker
      ? String(marker.metadata.anchorDay)
      : (options.anchorDay ?? currentAnchor(options.now));
    validateAnchor(anchorDay);
    if (!marker && anchorDay > currentAnchor(options.now))
      throw new Error("Initial anchor cannot create future cash history");
    if (options.anchorDay && options.anchorDay !== anchorDay)
      throw new Error(
        "Persisted anchor cannot be moved; use a new reviewed seed version",
      );
    const [settings] = await tx
      .select()
      .from(schema.registrationSettings)
      .where(eq(schema.registrationSettings.id, 1));
    if (!settings)
      throw new Error(
        "Registration settings must already exist; seed never changes global settings",
      );
    const minimum = marker
      ? Number(marker.metadata.minimumPaymentPercent)
      : settings.minimumPaymentPercent;
    const plan = financialDemoPlan(anchorDay, minimum);
    if (marker) {
      if (
        marker.action !== "DEMO_SEEDED" ||
        marker.entityType !== "DEMO" ||
        marker.entityId !== markerId ||
        marker.actorId !== actor.id ||
        marker.metadata.seedOwner !== FINANCIAL_DEMO_OWNER ||
        marker.metadata.planHash !== fingerprint(plan) ||
        marker.metadata.stateHash !== (await stateHash(tx, plan))
      )
        throw new Error(
          "Fixture provenance or state changed; no repair or financial replay allowed",
        );
      const context: FinancialDemoContext = JSON.parse(
        String(marker.metadata.context),
      );
      if (
        context.owner !== FINANCIAL_DEMO_OWNER ||
        context.anchorDay !== anchorDay ||
        marker.metadata.contextHash !== fingerprint(context)
      )
        throw new Error("Invalid fixture context");
      options.preview?.(plan, true);
      if (options.attendance)
        await runAttendanceDemo(
          tx,
          actor,
          context,
          options.apply,
          options.attendancePreview,
        );
      if (options.attendance)
        await completeDemoCalendars(
          tx,
          actor,
          options.apply,
          options.now ?? new Date(),
          options.calendarsPreview,
        );
      return context;
    }
    await assertNoCollisions(tx, plan);
    for (const sample of plan.samples)
      if (
        await instructorHasConflict(
          tx,
          sample.course.id,
          instructors[sample.teacher],
          sample.groups,
        )
      )
        throw new Error("Demo instructor schedule conflicts");
    options.preview?.(plan, false);
    const plannedContext: FinancialDemoContext = {
      owner: FINANCIAL_DEMO_OWNER,
      anchorDay,
      registrations: {},
      courses: Object.fromEntries(
        plan.samples.map((s) => [
          s.key,
          { courseId: s.course.id, groupIds: s.groups.map((g) => g.id) },
        ]),
      ),
    };
    if (options.attendance)
      await runAttendanceDemo(
        tx,
        actor,
        plannedContext,
        false,
        options.attendancePreview,
      );
    if (!options.apply) {
      if (options.attendance)
        await completeDemoCalendars(
          tx,
          actor,
          false,
          options.now ?? new Date(),
          options.calendarsPreview,
        );
      return plannedContext;
    }
    const context = await createFixtures(tx, plan, actor, instructors);
    await tx.insert(schema.auditEvents).values({
      id: markerId,
      actorId: actor.id,
      entityType: "DEMO",
      entityId: markerId,
      action: "DEMO_SEEDED",
      metadata: {
        seedOwner: FINANCIAL_DEMO_OWNER,
        anchorDay,
        minimumPaymentPercent: minimum,
        planHash: fingerprint(plan),
        stateHash: await stateHash(tx, plan),
        context: JSON.stringify(context),
        contextHash: fingerprint(context),
      },
    });
    if (options.attendance) await runAttendanceDemo(tx, actor, context, true);
    if (options.attendance)
      await completeDemoCalendars(
        tx,
        actor,
        true,
        options.now ?? new Date(),
        options.calendarsPreview,
      );
    return context;
  });
}

if (import.meta.main) {
  let connection: ReturnType<typeof createDatabase> | undefined;
  try {
    const args = process.argv.slice(2);
    const allowed = new Set([
      "--target",
      "--project",
      "--anchor",
      "--apply",
      "--attendance",
      "--approved-production-operator",
    ]);
    const values = new Map<string, string>();
    let apply = false;
    for (let i = 0; i < args.length; i++) {
      const key = args[i]!;
      if (!allowed.has(key) || values.has(key) || (key === "--apply" && apply))
        throw new Error("Invalid arguments");
      if (key === "--apply") apply = true;
      else if (
        key === "--attendance" ||
        key === "--approved-production-operator"
      )
        values.set(key, "true");
      else {
        const value = args[++i];
        if (!value || value.startsWith("--"))
          throw new Error("Argument value required");
        values.set(key, value);
      }
    }
    const target = values.get("--target") ?? "";
    assertFinancialExecution(
      process.env,
      values.has("--approved-production-operator"),
      target,
      values.get("--project") ?? "",
    );
    const url = process.env.DEMO_DATABASE_URL ?? "";
    const api = process.env.DEMO_SUPABASE_URL ?? "";
    assertFinancialTarget(target, url, api, values.get("--project") ?? "");
    if (target === "local") {
      const local = getLocalSupabaseEnvironment();
      if (local.databaseUrl !== url || local.apiUrl !== api)
        throw new Error(
          "Local connection does not match running configured Supabase",
        );
    }
    const key = process.env.DEMO_SUPABASE_SERVICE_ROLE_KEY;
    if (!key)
      throw new Error("Read-only Auth verification credential required");
    const auth = createClient(api, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    connection = createDatabase(url, { max: 1 });
    const context = await runFinancialDemo(connection.db, {
      actorId: process.env.DEMO_ADMIN_ID ?? "",
      apply,
      attendance: values.has("--attendance"),
      ...(values.has("--anchor")
        ? { anchorDay: validateAnchor(values.get("--anchor")!) }
        : {}),
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
      preview(plan, existing) {
        console.info(
          JSON.stringify(
            {
              mode: apply ? "APPLY" : "PLAN",
              target,
              owner: plan.owner,
              anchorDay: plan.anchorDay,
              existing,
              formats: plan.formats.length,
              courses: plan.samples.map((s) => ({
                name: s.course.name,
                id: s.course.id,
                startsAt: s.course.startsAt,
                endsAt: s.course.endsAt,
                groups: s.groups.map((g) => g.id),
                scenarios: s.registrations.map((r) => r.scenario),
              })),
              registrations: plan.samples.reduce(
                (n, s) => n + s.registrations.length,
                0,
              ),
              minimumPaymentPercent: plan.minimumPaymentPercent,
              preserved:
                "Auth, ADMIN, roles, profiles, sessions, Storage, SMTP, global settings, migration ledger and existing business data",
            },
            null,
            2,
          ),
        );
      },
      attendancePreview(plan, existing) {
        console.info(
          JSON.stringify(
            {
              mode: apply ? "APPLY" : "PLAN",
              target,
              owner: plan.owner,
              anchorDay: plan.anchorDay,
              existing,
              course: {
                name: plan.course.name,
                id: plan.course.id,
                startsAt: plan.course.startsAt,
                endsAt: plan.course.endsAt,
              },
              formats: 1,
              groups: plan.groups.map((g) => g.id),
              registrations: plan.participants.map((p) => p.key),
              sessionsPerGroup: plan.calendar.length,
              consecutiveAbsenceLimit: plan.limit,
              reviewedSessions: plan.reviewedCount,
              todayReplacementAt: plan.todayReplacementAt,
              weekendReplacementAt: plan.weekendReplacementAt,
              attendanceTables: ATTENDANCE_DEMO_TABLES,
              resetAllowed: false,
              globalSettingsChanged: false,
            },
            null,
            2,
          ),
        );
      },
      calendarsPreview(plan) {
        console.info(
          JSON.stringify(
            {
              calendarOwner: "skillbase-demo-calendars-v1",
              mode: apply ? "APPLY" : "PLAN",
              ownedGroups: plan.length,
              missingCalendars: plan.filter((row) => row.missing).length,
              newOriginalSessions: plan
                .filter((row) => row.missing)
                .reduce((n, row) => n + row.expectedOriginals, 0),
              groups: plan,
              preserveExistingSessions: true,
              unownedCoursesExcluded: true,
            },
            null,
            2,
          ),
        );
      },
    });
    console.info(
      apply
        ? `Demo ready: ${context.owner}; anchor ${context.anchorDay}. No mail sent.`
        : "PLAN only: no rows written. Review before explicit --apply.",
    );
  } catch {
    console.error(
      "Demo refused or failed; no credentials or database errors printed. Verify explicit target/project, active ADMIN, seed-owned instructors, migrations (0019 for --attendance), settings, anchor and fixture collisions. Never reset or disable guards to resolve this failure.",
    );
    process.exitCode = 1;
  } finally {
    await connection?.close();
  }
}
