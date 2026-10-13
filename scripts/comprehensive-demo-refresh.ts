import type { SupabaseClient } from "@supabase/supabase-js";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type {
  RegistrationDatabase,
  RegistrationTransaction,
} from "@/server/db/repositories/registration-support";
import { requireFreshRegistrationActor } from "@/server/db/repositories/registration-support";
import { resolveActiveUser } from "@/application/auth/authorize";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import {
  lockInstructorSchedules,
  assertActiveInstructor,
  instructorHasConflict,
} from "@/server/db/repositories/instructor-schedule";
import {
  runComprehensiveDemo,
  createBusinessFixtures,
  preflight,
  type ComprehensiveDemoOptions,
} from "./comprehensive-demo";
import {
  comprehensiveDemoId,
  comprehensiveDemoPlan,
  legacyComprehensiveDemoPlan,
  realisticInstructorNames,
  realisticAdminNames,
  REALISTIC_SEED_VERSION,
  COMPREHENSIVE_DEMO_OWNER,
  type ComprehensiveDemoPlan,
  type ComprehensiveDemoContext,
} from "./comprehensive-demo-plan";
import { currentAnchor, fingerprint } from "./financial-demo-plan";
import {
  assertApprovedDemoMigrationLedger,
  type DemoMigrationLedgerRow,
} from "./approved-demo-migration-ledger";
import type { ApprovedDemoRowChange } from "./comprehensive-demo-preservation";

const refreshId = comprehensiveDemoId("refresh:realistic-v2");
type EditableTable =
  | "courses"
  | "course_types"
  | "participants"
  | "users"
  | "instructor_profiles"
  | "interest_registrations";
type EditorialChange = {
  table: EditableTable;
  id: string;
  field:
    | "name"
    | "first_name"
    | "last_name"
    | "paternal_surname"
    | "maternal_surname"
    | "description"
    | "conditions"
    | "content_markdown";
  before: string;
  after: string;
  rowHash: string;
  beforeRevision: string;
  revisionAt: string;
};
export interface RealisticRefreshOptions extends Omit<
  ComprehensiveDemoOptions,
  "preview"
> {
  primaryAdminEmail?: string;
  confirmedPrimaryAdminId?: string;
  preview?: (plan: RealisticRefreshPlan) => void;
}
export interface RealisticRefreshPlan {
  version: string;
  completed: boolean;
  anchorDay: string;
  edits: EditorialChange[];
  additions: ComprehensiveDemoPlan | null;
  primaryAdminRole: {
    userId: string;
    remove: "INSTRUCTOR";
    rowHash: string;
    userRowHash: string;
    providerIdentityId: string;
  } | null;
  preservedCertificates: {
    id: string;
    state: string;
    signedSha256: string | null;
  }[];
  preservedClosureVersionIds: string[];
  skipped: {
    table: EditableTable;
    id: string;
    field: string;
    reason: string;
  }[];
  settingsHash: string;
}

/** The principal can be a non-fixture identity: keep UUID/provider references
 * private even though the other scenario rows are entirely synthetic. */
export function redactRefreshPlan(plan: RealisticRefreshPlan) {
  return {
    ...plan,
    primaryAdminRole: plan.primaryAdminRole
      ? {
          remove: plan.primaryAdminRole.remove,
          privatelyConfirmed: true,
          identityFingerprint: fingerprint({
            userId: plan.primaryAdminRole.userId,
            providerIdentityId: plan.primaryAdminRole.providerIdentityId,
          }),
          rowHash: plan.primaryAdminRole.rowHash,
        }
      : null,
  };
}

async function rawRow(
  tx: RegistrationTransaction,
  table: string,
  id: string,
  lock = false,
): Promise<Record<string, unknown>> {
  const rows = await tx.execute<{ row: Record<string, unknown> }>(
    sql`select to_jsonb(t) as row from ${sql.identifier(table)} t where id=${id}::uuid ${lock ? sql`for update` : sql``}`,
  );
  if (!rows[0]) throw new Error("Owned editorial row missing");
  return rows[0].row;
}

async function planRefresh(
  db: RegistrationDatabase,
  options: RealisticRefreshOptions,
  context: ComprehensiveDemoContext,
  auth: SupabaseClient,
) {
  return db.transaction(async (tx): Promise<RealisticRefreshPlan> => {
    await tx.execute(
      sql`set transaction isolation level repeatable read read only`,
    );
    const ledger = await tx.execute<DemoMigrationLedgerRow>(
      sql`select id,hash,created_at::text as "createdAt" from drizzle.__drizzle_migrations order by id`,
    );
    assertApprovedDemoMigrationLedger(ledger);
    const [done] = await tx
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, refreshId));
    if (done) {
      if (
        done.actorId !== options.actorId ||
        done.action !== "DEMO_SEEDED" ||
        done.metadata.seedOwner !== COMPREHENSIVE_DEMO_OWNER ||
        done.metadata.version !== REALISTIC_SEED_VERSION
      )
        throw new Error("Refresh completion provenance changed");
      const completed: RealisticRefreshPlan = JSON.parse(
        String(done.metadata.plan),
      );
      if (fingerprint(completed) !== done.metadata.planHash)
        throw new Error("Refresh plan evidence changed");
      return {
        ...completed,
        completed: true,
        edits: [],
        additions: null,
        primaryAdminRole: null,
      };
    }
    const [manifest] = await tx
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, comprehensiveDemoId("manifest")));
    if (!manifest) throw new Error("Completed original seed required");
    const old = legacyComprehensiveDemoPlan(
      context.anchorDay,
      Number(manifest.metadata.limit),
      Number(manifest.metadata.minimumPaymentPercent),
    );
    const modern = comprehensiveDemoPlan(
      context.anchorDay,
      old.limit,
      old.minimumPaymentPercent,
    );
    const anchorDay = currentAnchor(options.now);
    const [registrationSettings] = await tx
      .select()
      .from(s.registrationSettings)
      .where(eq(s.registrationSettings.id, 1));
    const [attendanceSettings] = await tx
      .select()
      .from(s.attendanceSettings)
      .where(eq(s.attendanceSettings.id, 1));
    if (!registrationSettings || !attendanceSettings)
      throw new Error("Existing settings required");
    const settingsHash = fingerprint({
      registrationSettings,
      attendanceSettings,
    });
    const additions = comprehensiveDemoPlan(
      anchorDay,
      old.limit,
      registrationSettings.minimumPaymentPercent,
    );
    additions.samples = additions.samples.filter((sample) =>
      String(sample.key).startsWith("next-"),
    );
    additions.formats = additions.formats.filter(
      (format) => format.id === comprehensiveDemoId("format:unused"),
    );
    const edits: EditorialChange[] = [];
    const skipped: RealisticRefreshPlan["skipped"] = [];
    const change = async (
      table: EditableTable,
      id: string,
      field: EditorialChange["field"],
      before: string | readonly string[],
      after: string,
    ) => {
      const row = await rawRow(tx, table, id);
      if (row[field] === after) return;
      const approvedBefore = typeof before === "string" ? [before] : before;
      if (!approvedBefore.includes(String(row[field]))) {
        skipped.push({
          table,
          id,
          field,
          reason: "Manual or unrecognized value preserved",
        });
        return;
      }
      edits.push({
        table,
        id,
        field,
        before: String(row[field]),
        after,
        rowHash: fingerprint(row),
        beforeRevision: String(row.updated_at),
        revisionAt: new Date(
          Math.max(
            Date.parse(String(row.updated_at)) + 1,
            modern.now.getTime(),
          ),
        ).toISOString(),
      });
    };
    for (const sample of old.samples) {
      const [marker] = await tx
        .select()
        .from(s.auditEvents)
        .where(
          eq(
            s.auditEvents.id,
            comprehensiveDemoId(`course-marker:${sample.key}`),
          ),
        );
      if (
        marker?.entityId !== sample.course.id ||
        marker?.action !== "DEMO_SEEDED" ||
        marker?.entityType !== "COURSE" ||
        marker.actorId !== options.actorId ||
        marker.metadata.seedOwner !== COMPREHENSIVE_DEMO_OWNER ||
        context.courses[sample.key]?.courseId !== sample.course.id
      )
        throw new Error("Owned course mapping changed");
      await change(
        "courses",
        sample.course.id,
        "name",
        [sample.course.name, sample.course.name.replace(/^\[DEMO\] /u, "")],
        modern.samples.find((row) => row.key === sample.key)!.course.name,
      );
      const updatedCourse = modern.samples.find(
        (row) => row.key === sample.key,
      )!.course;
      await change(
        "courses",
        sample.course.id,
        "description",
        sample.course.description,
        updatedCourse.description,
      );
      await change(
        "courses",
        sample.course.id,
        "conditions",
        sample.course.conditions,
        updatedCourse.conditions,
      );
      await change(
        "courses",
        sample.course.id,
        "content_markdown",
        sample.course.contentMarkdown,
        updatedCourse.contentMarkdown,
      );
      for (const registration of sample.registrations) {
        const registrationId = context.registrations[registration.key];
        const [record] = await tx
          .select()
          .from(s.preRegistrations)
          .where(eq(s.preRegistrations.id, registrationId!));
        if (!record || record.courseId !== sample.course.id)
          throw new Error("Owned registration mapping changed");
        const [participant] = await tx
          .select()
          .from(s.participants)
          .where(eq(s.participants.id, record.participantId));
        if (
          participant?.ci !== registration.participant.ci ||
          participant.email !== registration.participant.email
        )
          throw new Error("Owned participant identity changed");
        const dependencies = await tx
          .select()
          .from(s.preRegistrations)
          .where(eq(s.preRegistrations.participantId, participant.id));
        if (
          dependencies.some(
            (dependency) =>
              !Object.values(context.registrations).includes(dependency.id),
          )
        )
          throw new Error("Participant shared outside approved seed");
        if (
          !edits.some(
            (edit) =>
              edit.table === "participants" && edit.id === participant.id,
          )
        ) {
          await change(
            "participants",
            participant.id,
            "paternal_surname",
            "Demo",
            modern.samples
              .find((row) => row.key === sample.key)!
              .registrations.find((row) => row.key === registration.key)!
              .participant.paternalSurname,
          );
          await change(
            "participants",
            participant.id,
            "maternal_surname",
            registration.participant.maternalSurname,
            modern.samples
              .find((row) => row.key === sample.key)!
              .registrations.find((row) => row.key === registration.key)!
              .participant.maternalSurname,
          );
        }
      }
    }
    for (const format of old.formats) {
      const row = await rawRow(tx, "course_types", format.id);
      const [revision] = await tx
        .select()
        .from(s.courseTypeRevisions)
        .where(
          eq(
            s.courseTypeRevisions.id,
            comprehensiveDemoId(`revision:${format.id}`),
          ),
        );
      if (
        !revision ||
        revision.courseTypeId !== row.id ||
        revision.totalHours !== format.totalHours ||
        revision.sessionMinutes !== format.sessionMinutes ||
        revision.studentAmount !== format.studentAmount ||
        revision.externalAmount !== format.externalAmount
      )
        throw new Error("Owned format terms changed");
      await change(
        "course_types",
        format.id,
        "name",
        format.name,
        modern.formats.find((row) => row.id === format.id)!.name,
      );
    }
    for (const [i, id] of context.instructors.entries()) {
      const [marker] = await tx
        .select()
        .from(s.auditEvents)
        .where(
          eq(s.auditEvents.id, comprehensiveDemoId(`account:instructor-${i}`)),
        );
      const [user] = await tx.select().from(s.users).where(eq(s.users.id, id));
      if (
        marker?.entityId !== id ||
        marker?.action !== "DEMO_SEEDED" ||
        marker?.entityType !== "USER" ||
        marker.actorId !== options.actorId ||
        marker.metadata.seedOwner !== COMPREHENSIVE_DEMO_OWNER ||
        user?.email !== `comprehensive.v1.instructor-${i}@example.test` ||
        !user.authUserId
      )
        throw new Error("Instructor ownership changed");
      const identity = await auth.auth.admin.getUserById(user.authUserId);
      if (
        identity.error ||
        identity.data.user?.app_metadata.seed_owner !== COMPREHENSIVE_DEMO_OWNER
      )
        throw new Error("Owned Auth identity required");
      await change(
        "users",
        id,
        "name",
        [`[DEMO] Docente ${i + 1}`, `Docente Demo ${i}`],
        realisticInstructorNames[i]!.join(" "),
      );
      await change(
        "instructor_profiles",
        id,
        "first_name",
        "Docente",
        realisticInstructorNames[i]![0],
      );
      await change(
        "instructor_profiles",
        id,
        "last_name",
        `Demo ${i}`,
        realisticInstructorNames[i]![1],
      );
    }
    for (const [key, id] of Object.entries(context.admins)) {
      if (key === "deleted") continue; // Never alter the lifecycle tombstone.
      const [marker] = await tx
        .select()
        .from(s.auditEvents)
        .where(eq(s.auditEvents.id, comprehensiveDemoId(`account:${key}`)));
      const [user] = await tx.select().from(s.users).where(eq(s.users.id, id));
      if (
        marker?.entityId !== id ||
        marker?.action !== "DEMO_SEEDED" ||
        marker?.entityType !== "USER" ||
        marker.actorId !== options.actorId ||
        marker.metadata.seedOwner !== COMPREHENSIVE_DEMO_OWNER ||
        user?.email !== `comprehensive.v1.${key}@example.test` ||
        !user.authUserId
      )
        throw new Error("ADMIN ownership changed");
      const identity = await auth.auth.admin.getUserById(user.authUserId);
      if (
        identity.error ||
        identity.data.user?.app_metadata.seed_owner !== COMPREHENSIVE_DEMO_OWNER
      )
        throw new Error("Owned Auth identity required");
      const before =
        key === "operator"
          ? "[DEMO] Coordinación académica · actualizado"
          : `[DEMO] ADMIN ${key}${["disabled", "reactivated"].includes(key) ? " · con actividad" : ""}`;
      await change("users", id, "name", before, realisticAdminNames[key]!);
    }
    for (const [i, key] of ["future", "free"].entries()) {
      const [convertedInterest] = await tx
        .select()
        .from(s.interestRegistrations)
        .where(
          and(
            eq(
              s.interestRegistrations.courseId,
              context.courses[key]!.courseId,
            ),
            eq(
              s.interestRegistrations.email,
              old.samples.find((sample) => sample.key === "closed")!
                .registrations[0]!.participant.email,
            ),
          ),
        );
      if (convertedInterest) {
        await change(
          "interest_registrations",
          convertedInterest.id,
          "paternal_surname",
          "Demo",
          modern.samples.find((sample) => sample.key === "closed")!
            .registrations[0]!.participant.paternalSurname,
        );
        await change(
          "interest_registrations",
          convertedInterest.id,
          "maternal_surname",
          old.samples.find((sample) => sample.key === "closed")!
            .registrations[0]!.participant.maternalSurname,
          modern.samples.find((sample) => sample.key === "closed")!
            .registrations[0]!.participant.maternalSurname,
        );
      }
      for (let n = 1; n < 6; n++) {
        const [interest] = await tx
          .select()
          .from(s.interestRegistrations)
          .where(
            and(
              eq(
                s.interestRegistrations.courseId,
                context.courses[key]!.courseId,
              ),
              eq(
                s.interestRegistrations.email,
                `comprehensive.v1.interest.${i}.${n}@example.test`,
              ),
            ),
          );
        if (interest)
          await change(
            "interest_registrations",
            interest.id,
            "paternal_surname",
            "Demo Interés",
            [
              "Varela Durán",
              "Rivas Toledo",
              "Zamora Téllez",
              "Beltrán Orellana",
              "Figueroa Montes",
              "Palacios Ugarte",
            ][n]!,
          );
      }
    }
    // Source profiles inserted by v2 already own the additional cohorts.
    if (manifest.metadata.planVersion === REALISTIC_SEED_VERSION) {
      additions.samples = [];
      additions.formats = [];
    }
    for (const sample of additions.samples) {
      const instructorId = context.instructors[sample.teacher]!;
      await assertActiveInstructor(tx, instructorId, false);
      if (
        await instructorHasConflict(
          tx,
          sample.course.id,
          instructorId,
          sample.groups,
        )
      )
        throw new Error(
          "Seasonal instructor conflict; do not shift existing schedules",
        );
      const existing = await tx
        .select()
        .from(s.courses)
        .where(eq(s.courses.id, sample.course.id));
      if (existing.length)
        throw new Error("Seasonal cohort collision; never adopt or move dates");
    }
    if (additions.samples.length) await preflight(tx, additions);
    let primaryAdminRole: RealisticRefreshPlan["primaryAdminRole"] = null;
    if (options.primaryAdminEmail || options.confirmedPrimaryAdminId) {
      const [primary] = await tx
        .select()
        .from(s.users)
        .where(
          eq(
            s.users.id,
            options.confirmedPrimaryAdminId ??
              comprehensiveDemoId("not-a-primary"),
          ),
        );
      if (
        !primary ||
        primary.email !== options.primaryAdminEmail?.trim().toLowerCase() ||
        primary.authPrimaryProvider !== "GOOGLE" ||
        primary.status !== "ACTIVE" ||
        !primary.authUserId
      )
        throw new Error(
          "Privately confirmed exact primary GOOGLE ADMIN required",
        );
      const identity = await auth.auth.admin.getUserById(primary.authUserId);
      const provider = identity.data.user?.identities?.find(
        (provider) =>
          provider.provider === "google" &&
          (primary.approvedGoogleIdentityId === null ||
            provider.id === primary.approvedGoogleIdentityId),
      );
      if (
        identity.error ||
        identity.data.user?.email !== primary.email ||
        !identity.data.user.email_confirmed_at ||
        provider?.identity_data?.email_verified !== true ||
        String(provider.identity_data.email).trim().toLowerCase() !==
          primary.email
      )
        throw new Error("Legitimate primary Google provider required");
      const roles = await tx
        .select()
        .from(s.userRoles)
        .where(eq(s.userRoles.userId, primary.id));
      if (!roles.some((role) => role.roleCode === "ADMIN"))
        throw new Error("Primary ADMIN role required");
      if (roles.some((role) => role.roleCode === "INSTRUCTOR")) {
        const assignments = await tx
          .select()
          .from(s.courses)
          .where(eq(s.courses.instructorId, primary.id));
        const history = await tx
          .select()
          .from(s.courseInstructorHistory)
          .where(eq(s.courseInstructorHistory.instructorId, primary.id));
        if (assignments.length || history.length)
          throw new Error(
            "Primary instructor has course history; coordinate role removal separately",
          );
        const rows = await tx.execute<{ row: Record<string, unknown> }>(
          sql`select to_jsonb(t) as row from user_roles t where user_id=${primary.id}::uuid and role_code='INSTRUCTOR'`,
        );
        primaryAdminRole = {
          userId: primary.id,
          remove: "INSTRUCTOR",
          rowHash: fingerprint(rows[0]!.row),
          userRowHash: fingerprint(await rawRow(tx, "users", primary.id)),
          providerIdentityId: provider.id,
        };
      }
    }
    const preservedCertificates = await tx
      .select({
        id: s.certificates.id,
        state: s.certificates.state,
        signedSha256: s.certificates.signedSha256,
      })
      .from(s.certificates);
    const versions = await tx
      .select({ id: s.academicClosureVersions.id })
      .from(s.academicClosureVersions);
    return {
      version: REALISTIC_SEED_VERSION,
      completed: false,
      anchorDay,
      edits,
      additions,
      primaryAdminRole,
      preservedCertificates,
      preservedClosureVersionIds: versions.map((version) => version.id),
      skipped,
      settingsHash,
    };
  });
}

/** Explicit editorial migration. Nothing in the normal v1 replay calls this.
 * Each exact reviewed original row is the sole preservation exception. */
export async function runRealisticScenarioRefresh(
  db: RegistrationDatabase,
  options: RealisticRefreshOptions,
) {
  const context = await runComprehensiveDemo(db, {
    actorId: options.actorId,
    auth: options.auth,
    password: options.password,
    apply: false,
  });
  if (!context) throw new Error("Refresh requires completed owned F8");
  const plan = await planRefresh(db, options, context, options.auth);
  options.preview?.(plan);
  if (!options.apply || plan.completed) return plan;
  if (
    !options.expectedPlanHash ||
    fingerprint(plan) !== options.expectedPlanHash
  )
    throw new Error("Explicit matching reviewed refresh PLAN required");
  return db.transaction(async (tx) => {
    await lockInstructorSchedules(tx);
    await requireFreshRegistrationActor(tx, options.actorId);
    const [user] = await tx
      .select()
      .from(s.users)
      .where(eq(s.users.id, options.actorId));
    const actor = await resolveActiveUser(
      new DrizzleAuthUserRepository(tx),
      user!.authUserId!,
    );
    await tx.execute(sql`select pg_advisory_xact_lock(20260915, 3)`);
    await tx.execute(sql`select pg_advisory_xact_lock(20260915, 1)`);
    const [registrationSettings] = await tx
      .select()
      .from(s.registrationSettings)
      .where(eq(s.registrationSettings.id, 1))
      .for("share");
    const [attendanceSettings] = await tx
      .select()
      .from(s.attendanceSettings)
      .where(eq(s.attendanceSettings.id, 1))
      .for("share");
    if (
      fingerprint({ registrationSettings, attendanceSettings }) !==
      plan.settingsHash
    )
      throw new Error("Reviewed settings changed");
    const applied: EditorialChange[] = [];
    for (const edit of plan.edits) {
      const row = await rawRow(tx, edit.table, edit.id, true);
      const original = { ...row };
      for (const prior of applied.filter(
        (prior) => prior.table === edit.table && prior.id === edit.id,
      )) {
        if (row[prior.field] !== prior.after)
          throw new Error("Applied editorial row changed");
        original[prior.field] = prior.before;
        if (Date.parse(String(row.updated_at)) !== Date.parse(prior.revisionAt))
          throw new Error("Applied editorial revision changed");
        original.updated_at = prior.beforeRevision;
      }
      if (fingerprint(original) !== edit.rowHash)
        throw new Error("Reviewed editorial row changed");
      if (row[edit.field] !== edit.before)
        throw new Error("Reviewed editorial value changed");
      await tx.execute(
        sql`update ${sql.identifier(edit.table)} set ${sql.identifier(edit.field)}=${edit.after},updated_at=${edit.revisionAt}::timestamptz where id=${edit.id}::uuid`,
      );
      applied.push(edit);
    }
    if (plan.primaryAdminRole) {
      const primary = await rawRow(
        tx,
        "users",
        plan.primaryAdminRole.userId,
        true,
      );
      if (fingerprint(primary) !== plan.primaryAdminRole.userRowHash)
        throw new Error("Reviewed primary identity changed");
      await requireFreshRegistrationActor(tx, plan.primaryAdminRole.userId);
      const provider = await options.auth.auth.admin.getUserById(
        String(primary.auth_user_id),
      );
      if (
        provider.error ||
        !provider.data.user?.identities?.some(
          (identity) =>
            identity.id === plan.primaryAdminRole!.providerIdentityId &&
            identity.provider === "google" &&
            identity.identity_data?.email_verified === true &&
            identity.identity_data.email === primary.email,
        )
      )
        throw new Error("Reviewed primary Google provider changed");
      const assignments = await tx
        .select()
        .from(s.courses)
        .where(eq(s.courses.instructorId, plan.primaryAdminRole.userId));
      const history = await tx
        .select()
        .from(s.courseInstructorHistory)
        .where(
          eq(
            s.courseInstructorHistory.instructorId,
            plan.primaryAdminRole.userId,
          ),
        );
      if (assignments.length || history.length)
        throw new Error("Reviewed primary instructor dependencies changed");
      const rows = await tx.execute<{ row: Record<string, unknown> }>(
        sql`select to_jsonb(t) as row from user_roles t where user_id=${plan.primaryAdminRole.userId}::uuid and role_code='INSTRUCTOR' for update`,
      );
      if (fingerprint(rows[0]?.row) !== plan.primaryAdminRole.rowHash)
        throw new Error("Reviewed primary role changed");
      await tx
        .delete(s.userRoles)
        .where(
          and(
            eq(s.userRoles.userId, plan.primaryAdminRole.userId),
            eq(s.userRoles.roleCode, "INSTRUCTOR"),
          ),
        );
    }
    if (plan.additions?.samples.length) {
      // Explicitly reject all planned-ID/slug/CI/format collisions before writes.
      const courseHits = await tx
        .select()
        .from(s.courses)
        .where(
          inArray(
            s.courses.slug,
            plan.additions.samples.map((sample) => sample.course.slug),
          ),
        );
      const personHits = await tx
        .select()
        .from(s.participants)
        .where(
          inArray(
            s.participants.ci,
            plan.additions.samples.flatMap((sample) =>
              sample.registrations.map(
                (registration) => registration.participant.ci,
              ),
            ),
          ),
        );
      if (courseHits.length || personHits.length)
        throw new Error("Unowned seasonal fixture collision");
      const added = await createBusinessFixtures(tx, actor, plan.additions, {
        instructors: context.instructors,
        admins: context.admins,
      });
      await tx.insert(s.auditEvents).values({
        id: comprehensiveDemoId("refresh:realistic-v2:context"),
        actorId: options.actorId,
        entityType: "DEMO",
        entityId: refreshId,
        action: "DEMO_SEEDED",
        metadata: {
          seedOwner: COMPREHENSIVE_DEMO_OWNER,
          context: JSON.stringify(added),
          contextHash: fingerprint(added),
        },
      });
    }
    await tx.insert(s.auditEvents).values({
      id: refreshId,
      actorId: options.actorId,
      entityType: "DEMO",
      entityId: refreshId,
      action: "DEMO_SEEDED",
      metadata: {
        seedOwner: COMPREHENSIVE_DEMO_OWNER,
        version: REALISTIC_SEED_VERSION,
        plan: JSON.stringify(plan),
        planHash: fingerprint(plan),
      },
    });
    return plan;
  });
}

/** Private per-row preservation witness, derived from exact PLAN-selected rows.
 * Never publish these hashes or raw row JSON in CI artifacts. */
export async function captureRefreshChanges(
  db: RegistrationDatabase,
  plan: RealisticRefreshPlan,
): Promise<ApprovedDemoRowChange[]> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`set transaction isolation level repeatable read read only`,
    );
    const changes: ApprovedDemoRowChange[] = [];
    const selected = new Map<string, EditorialChange[]>();
    for (const edit of plan.edits) {
      const key = `${edit.table}:${edit.id}`;
      selected.set(key, [...(selected.get(key) ?? []), edit]);
    }
    for (const edits of selected.values()) {
      const edit = edits[0]!;
      const row = await rawRow(tx, edit.table, edit.id);
      if (fingerprint(row) !== edit.rowHash)
        throw new Error("Reviewed original row changed before witness capture");
      const patch = Object.fromEntries(
        edits.map((change) => [change.field, change.after]),
      );
      const rows = await tx.execute<{
        keyHash: string;
        beforeHash: string;
        afterHash: string;
      }>(
        sql`select encode(sha256(convert_to(jsonb_build_object('id',t.id)::text,'UTF8')),'hex') as "keyHash",encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as "beforeHash",encode(sha256(convert_to((to_jsonb(t) || ${JSON.stringify(patch)}::jsonb || jsonb_build_object('updated_at',${edit.revisionAt}::timestamptz))::text,'UTF8')),'hex') as "afterHash" from ${sql.identifier(edit.table)} t where id=${edit.id}::uuid`,
      );
      changes.push({ table: `public.${edit.table}`, ...rows[0]! });
    }
    if (plan.primaryAdminRole) {
      const rows = await tx.execute<{ keyHash: string; beforeHash: string }>(
        sql`select encode(sha256(convert_to(jsonb_build_object('user_id',t.user_id,'role_code',t.role_code)::text,'UTF8')),'hex') as "keyHash",encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as "beforeHash" from user_roles t where user_id=${plan.primaryAdminRole.userId}::uuid and role_code='INSTRUCTOR'`,
      );
      if (!rows[0])
        throw new Error("Reviewed role missing before witness capture");
      changes.push({ table: "public.user_roles", ...rows[0], afterHash: null });
    }
    return changes;
  });
}
