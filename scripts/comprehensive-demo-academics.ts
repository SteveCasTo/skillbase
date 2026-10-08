import { eq } from "drizzle-orm";
import type { InternalUser } from "@/domain/auth/types";
import {
  getAttendanceGroup,
  getAttendanceSession,
  recordAttendance,
  cancelAttendanceSession,
  replaceAttendanceSession,
} from "@/application/attendance/manage-attendance";
import {
  getCourseEvaluations,
  saveEvaluationScheme,
  saveEvaluationRow,
} from "@/application/evaluations/manage-evaluations";
import {
  closeAcademicGroup,
  reopenAcademicGroup,
} from "@/application/academic-closure/manage-closure";
import { renameAdminAccount } from "@/application/admin-accounts/manage-admin-accounts";
import { DrizzleAttendanceRepository } from "@/server/db/repositories/attendance-repository";
import { DrizzleEvaluationRepository } from "@/server/db/repositories/evaluation-repository";
import { DrizzleClosureRepository } from "@/server/db/repositories/academic-closure-repository";
import { DrizzleAdminAccountRepository } from "@/server/db/repositories/admin-account-repository";
import type { RegistrationTransaction } from "@/server/db/repositories/registration-support";
import * as s from "@/server/db/schema";
import {
  comprehensiveDemoId,
  type ComprehensiveDemoPlan,
  type ComprehensiveDemoContext,
} from "./comprehensive-demo-plan";
import { shiftedDay } from "./financial-demo-plan";

/** Synthetic history is intentionally generated through the real authorized use
 * cases. The trusted CLI clock is limited to new owned fixtures; no HTTP clock,
 * runtime authorization policy or database trigger is changed. */
export async function seedComprehensiveAcademics(
  tx: RegistrationTransaction,
  actor: InternalUser,
  plan: ComprehensiveDemoPlan,
  context: ComprehensiveDemoContext,
) {
  const attendance = new DrizzleAttendanceRepository(tx, () => plan.now);
  const evaluations = new DrizzleEvaluationRepository(tx, () => plan.now);
  const closure = new DrizzleClosureRepository(tx, () => plan.now);
  for (const sample of plan.samples) {
    if (sample.key !== "archived")
      await saveEvaluationScheme(evaluations, actor, {
        requestKey: comprehensiveDemoId(`scheme:${sample.key}`),
        courseId: sample.course.id,
        schemeRevision: 0,
        components: sample.components,
      });
    for (const group of sample.groups.filter((g) => g.status === "PLANNED")) {
      const calendar = await getAttendanceGroup(
        attendance,
        actor,
        sample.course.id,
        group.id,
      );
      if (!["closed", "reclosed", "pending", "current"].includes(sample.key))
        continue;
      const roster = await getCourseEvaluations(
        evaluations,
        actor,
        sample.course.id,
        group.id,
      );
      const eligible = roster.participants
        .filter((p) => p.membershipStatus === "INSCRITO")
        .sort(
          (a, b) =>
            Number(
              sample.registrations.some(
                (r) =>
                  r.scenario === "zero" &&
                  context.registrations[r.key] === b.registrationId,
              ),
            ) -
            Number(
              sample.registrations.some(
                (r) =>
                  r.scenario === "zero" &&
                  context.registrations[r.key] === a.registrationId,
              ),
            ),
        );
      const sessions = calendar.sessions.filter(
        (row) => row.civilDate < plan.anchorDay,
      );
      const reviewed =
        sample.key === "pending" ? sessions.slice(0, -1) : sessions;
      for (const [i, session] of reviewed.entries()) {
        await recordAttendance(attendance, actor, {
          requestKey: comprehensiveDemoId(
            `attendance:${sample.key}:${group.id}:${i}`,
          ),
          courseId: sample.course.id,
          groupId: group.id,
          sessionId: session.id,
          revision: session.revision,
          reviewRegistrationIds: eligible.map((p) => p.registrationId),
          completeAdministrativeReview: true,
          marks: eligible.map((person) => {
            const scenario = sample.registrations.find(
              (r) => context.registrations[r.key] === person.registrationId,
            )?.scenario;
            const absentCount =
              scenario === "warning"
                ? plan.limit
                : scenario === "ineligible"
                  ? plan.limit + 1
                  : 0;
            return {
              registrationId: person.registrationId,
              status:
                absentCount && i >= reviewed.length - absentCount
                  ? ("ABSENT" as const)
                  : i === 0
                    ? ("EXCUSED" as const)
                    : ("PRESENT" as const),
            };
          }),
          instructorStatus: i === 1 ? "EXCUSED" : "PRESENT",
        });
      }
      let schemeRevision = roster.scheme.revision;
      for (const person of eligible) {
        const scenario = sample.registrations.find(
          (r) => context.registrations[r.key] === person.registrationId,
        )?.scenario;
        const score =
          scenario === "zero"
            ? "0.00"
            : scenario === "failed"
              ? "54.25"
              : scenario === "boundary"
                ? "70.00"
                : "92.35";
        const components =
          sample.key === "pending" || sample.key === "current"
            ? sample.components.slice(0, 1)
            : sample.components;
        if (scenario === "pending") continue;
        const result = await saveEvaluationRow(evaluations, actor, {
          requestKey: comprehensiveDemoId(
            `grades:${sample.key}:${person.registrationId}`,
          ),
          courseId: sample.course.id,
          groupId: group.id,
          schemeRevision,
          registrationId: person.registrationId,
          grades: components.map((c) => ({
            componentId: c.id,
            gradeRevision: 0,
            score,
          })),
        });
        schemeRevision = result.schemeRevision;
      }
      if (sample.key === "current") {
        const future = calendar.sessions.filter(
          (row) => row.startsAt > plan.now.toISOString(),
        );
        if (future.length >= 3) {
          await cancelAttendanceSession(attendance, actor, {
            requestKey: comprehensiveDemoId("session:cancel"),
            courseId: sample.course.id,
            groupId: group.id,
            sessionId: future[0]!.id,
            revision: future[0]!.revision,
            reason: "[DEMO] Feriado: cancelación individual",
          });
          const today = await replaceAttendanceSession(attendance, actor, {
            requestKey: comprehensiveDemoId("session:replace"),
            courseId: sample.course.id,
            groupId: group.id,
            sessionId: future[1]!.id,
            revision: future[1]!.revision,
            startsAt: `${plan.anchorDay}T15:00`,
            reason: "[DEMO] Recuperación de sesión",
          });
          if (today.kind !== "session")
            throw new Error("Demo replacement receipt invalid");
          await getAttendanceSession(
            attendance,
            actor,
            sample.course.id,
            group.id,
            today.sessionId,
          );
          let weekend = shiftedDay(plan.anchorDay, 1);
          while (new Date(`${weekend}T00:00:00Z`).getUTCDay() !== 6)
            weekend = shiftedDay(weekend, 1);
          await replaceAttendanceSession(attendance, actor, {
            requestKey: comprehensiveDemoId("session:weekend"),
            courseId: sample.course.id,
            groupId: group.id,
            sessionId: future[2]!.id,
            revision: future[2]!.revision,
            startsAt: `${weekend}T15:00`,
            reason: "[DEMO] Recuperación en fin de semana",
          });
        }
      }
      if (sample.key === "closed" || sample.key === "reclosed") {
        const first = await closeAcademicGroup(closure, actor, {
          requestKey: comprehensiveDemoId(`close:${sample.key}:1`),
          courseId: sample.course.id,
          groupId: group.id,
          revision: 0,
        });
        if (sample.key === "reclosed") {
          const opened = await reopenAcademicGroup(closure, actor, {
            requestKey: comprehensiveDemoId("reopen:reclosed:1"),
            courseId: sample.course.id,
            groupId: group.id,
            revision: first.revision,
            reason:
              "[DEMO] Corrección administrativa de una nota; conservar versión anterior",
          });
          const fresh = await getCourseEvaluations(
            evaluations,
            actor,
            sample.course.id,
            group.id,
          );
          const person = fresh.participants.find(
            (p) =>
              p.registrationId === context.registrations["reclosed:1"] &&
              p.canGrade,
          )!;
          await saveEvaluationRow(evaluations, actor, {
            requestKey: comprehensiveDemoId("correction:reclosed"),
            courseId: sample.course.id,
            groupId: group.id,
            schemeRevision: fresh.scheme.revision,
            registrationId: person.registrationId,
            grades: [
              {
                componentId: sample.components[0]!.id,
                gradeRevision: person.grades[0]!.revision,
                score: "95.55",
              },
            ],
          });
          const [account] = await tx
            .select()
            .from(s.users)
            .where(eq(s.users.id, actor.id));
          await renameAdminAccount(
            new DrizzleAdminAccountRepository(tx),
            actor,
            actor.id,
            "[DEMO] Coordinación académica · actualizado",
            account!.updatedAt.toISOString(),
          );
          await closeAcademicGroup(closure, actor, {
            requestKey: comprehensiveDemoId("close:reclosed:2"),
            courseId: sample.course.id,
            groupId: group.id,
            revision: opened.revision,
          });
        }
      }
    }
  }
}
