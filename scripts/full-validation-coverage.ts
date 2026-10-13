import { and, eq } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegistrationDatabase } from "@/server/db/repositories/registration-support";
import * as s from "@/server/db/schema";
import { resolveActiveUser, requireRoles } from "@/application/auth/authorize";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { DrizzleInstructorLifecycleRepository } from "@/server/db/repositories/instructor-lifecycle-repository";
import { mutateInstructorLifecycle } from "@/application/instructors/lifecycle";
import { lockInstructorSchedules } from "@/server/db/repositories/instructor-schedule";
import { FULL_VALIDATION_OWNER } from "./full-validation-seed-matrix";
import { fullValidationPlanHash } from "./full-validation-reset-plan";

export async function validationAccountCoverage(db: RegistrationDatabase) {
  const people = await db
    .select({
      id: s.users.id,
      status: s.users.status,
      name: s.users.name,
      role: s.userRoles.roleCode,
    })
    .from(s.users)
    .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id));
  const courses = await db
    .select({ instructorId: s.courses.instructorId })
    .from(s.courses);
  const instructors = people
    .filter((person) => person.role === "INSTRUCTOR")
    .map((person) => ({
      ...person,
      courseCount: courses.filter((course) => course.instructorId === person.id)
        .length,
    }));
  return {
    admins: people
      .filter((person) => person.role === "ADMIN")
      .map(({ id, status, name }) => ({ id, status, name })),
    instructors,
  };
}

/** One explicitly reviewed retained, unassigned instructor is disabled through
 * the normal lifecycle. No credentials, provider or role is changed/deleted. */
export async function seedValidationCoverage(
  db: RegistrationDatabase,
  auth: SupabaseClient,
  options: {
    actorId: string;
    operationId: string;
    disabledInstructorId: string;
    apply: boolean;
    reviewedPlanSha256?: string;
  },
) {
  const [primary] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, options.actorId));
  if (!primary?.authUserId)
    throw new Error("Existing primary identity required");
  const identity = await auth.auth.admin.getUserById(primary.authUserId);
  if (identity.error || identity.data.user?.id !== primary.authUserId)
    throw new Error("Primary identity unavailable");
  const actor = await resolveActiveUser(
    new DrizzleAuthUserRepository(db),
    primary.authUserId,
  );
  requireRoles(actor, ["ADMIN"]);
  const coverage = await validationAccountCoverage(db);
  const candidate = coverage.instructors.find(
    (person) => person.id === options.disabledInstructorId,
  );
  const [target] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, options.disabledInstructorId));
  const roles = await db
    .select()
    .from(s.userRoles)
    .where(eq(s.userRoles.userId, options.disabledInstructorId));
  if (
    !candidate ||
    !target?.authUserId ||
    roles.length !== 1 ||
    roles[0]?.roleCode !== "INSTRUCTOR" ||
    candidate.courseCount !== 0 ||
    /demo|fictici|ejemplo/iu.test(target.name)
  )
    throw new Error("Reviewed retained natural unassigned instructor required");
  const otherFree = coverage.instructors.filter(
    (person) =>
      person.status === "ACTIVE" &&
      person.courseCount === 0 &&
      person.id !== candidate.id,
  );
  if (
    !otherFree.length ||
    !coverage.instructors.some(
      (person) => person.status === "ACTIVE" && person.courseCount > 0,
    )
  )
    throw new Error(
      "Actual active instructors with AND without courses are required",
    );
  const h = fullValidationPlanHash({
    owner: FULL_VALIDATION_OWNER,
    operationId: options.operationId,
    purpose: "account-coverage",
  });
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  const [complete] = await db
    .select()
    .from(s.auditEvents)
    .where(eq(s.auditEvents.id, id));
  if (complete) {
    if (
      complete.actorId !== actor.id ||
      complete.metadata.owner !== FULL_VALIDATION_OWNER ||
      complete.metadata.disabledInstructorId !== target.id ||
      (options.reviewedPlanSha256 &&
        complete.metadata.planSha256 !== options.reviewedPlanSha256)
    )
      throw new Error("Coverage receipt conflicts");
    assertCoverage(coverage);
    return {
      mode: "NOOP" as const,
      planSha256: String(complete.metadata.planSha256),
      coverage,
    };
  }
  if (!["ACTIVE", "DISABLED"].includes(target.status))
    throw new Error(
      "Never activate an invitation or missing identity to make coverage",
    );
  const plan = {
    owner: FULL_VALIDATION_OWNER,
    operationId: options.operationId,
    actorId: actor.id,
    disabledInstructorId: target.id,
    targetRevision: target.updatedAt.toISOString(),
    beforeStatus: target.status,
    afterStatus: "DISABLED",
    coverage,
  };
  const planSha256 = fullValidationPlanHash(plan);
  if (options.reviewedPlanSha256 && options.reviewedPlanSha256 !== planSha256)
    throw new Error("Reviewed account-coverage plan changed");
  if (!options.apply) return { mode: "PLAN" as const, planSha256, plan };
  if (!options.reviewedPlanSha256)
    throw new Error("Explicit coverage plan hash approval required");
  return db.transaction(async (tx) => {
    await lockInstructorSchedules(tx);
    const [reset] = await tx
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.id, options.operationId),
          eq(s.auditEvents.action, "VALIDATION_BUSINESS_RESET"),
        ),
      );
    if (reset?.actorId !== actor.id)
      throw new Error("Approved reset receipt required");
    if (target.status === "ACTIVE")
      await mutateInstructorLifecycle(
        new DrizzleInstructorLifecycleRepository(tx),
        {
          remove: async () => {
            throw new Error("Auth deletion forbidden in validation coverage");
          },
        },
        actor,
        target.id,
        "deactivate",
        target.updatedAt.toISOString(),
      );
    const actual = await validationAccountCoverage(tx);
    assertCoverage(actual);
    await tx.insert(s.auditEvents).values({
      id,
      actorId: actor.id,
      entityType: "BUSINESS_MAINTENANCE",
      entityId: options.operationId,
      action: "VALIDATION_COVERAGE_CONFIRMED",
      metadata: {
        owner: FULL_VALIDATION_OWNER,
        planSha256,
        disabledInstructorId: target.id,
        coverage: JSON.stringify(actual),
      },
    });
    return { mode: "APPLIED" as const, planSha256, coverage: actual };
  });
}

function assertCoverage(
  coverage: Awaited<ReturnType<typeof validationAccountCoverage>>,
) {
  for (const status of ["ACTIVE", "INVITED", "DISABLED"] as const) {
    if (
      !coverage.admins.some((person) => person.status === status) ||
      !coverage.instructors.some((person) => person.status === status)
    )
      throw new Error("Missing actual ADMIN/INSTRUCTOR status coverage");
  }
  if (
    !coverage.instructors.some(
      (person) => person.status === "ACTIVE" && person.courseCount === 0,
    ) ||
    !coverage.instructors.some(
      (person) => person.status === "ACTIVE" && person.courseCount > 0,
    )
  )
    throw new Error("Missing active instructor course assignment coverage");
}
