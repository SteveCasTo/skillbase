import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { ClosureRepository } from "@/application/academic-closure/closure-repository";
import {
  ClosureError,
  closureBlockers,
  closureId,
  validateClosureCommand,
  validateReopen,
} from "@/domain/academic-closure/rules";
import type {
  ClosureCommand,
  ClosureCommandResult,
  ClosureStateDto,
  ReopenGroupInput,
} from "@/domain/academic-closure/types";
import type {
  AttendanceDatabase,
  AttendanceTransaction,
} from "./attendance-calendar";
import { lockInstructorSchedules } from "./instructor-schedule";
import {
  buildClosureReport,
  closureVersionDto,
  privateClosureReport,
} from "./academic-closure-report";

async function context(
  tx: AttendanceTransaction,
  actorId: string,
  courseId: string,
  groupId: string,
  clock: () => Date,
  adminOnly = false,
) {
  closureId(actorId, "actorId");
  closureId(courseId, "courseId");
  closureId(groupId, "groupId");
  // Reuse the established schedule/financial/evaluation gate, then actor and parent
  // locks. This serializes snapshot creation with the last grade/attendance write.
  await lockInstructorSchedules(tx, courseId);
  const [actor] = await tx
    .select()
    .from(s.users)
    .where(eq(s.users.id, actorId))
    .for("share");
  const roles = await tx
    .select()
    .from(s.userRoles)
    .where(eq(s.userRoles.userId, actorId))
    .for("share");
  const admin = roles.some((role) => role.roleCode === "ADMIN");
  if (
    !actor ||
    actor.status !== "ACTIVE" ||
    (!admin &&
      (adminOnly || !roles.some((role) => role.roleCode === "INSTRUCTOR")))
  )
    throw new ClosureError(
      "FORBIDDEN",
      "La cuenta no tiene autorización vigente.",
    );
  const [course] = await tx
    .select()
    .from(s.courses)
    .where(eq(s.courses.id, courseId))
    .for("update");
  const [group] = await tx
    .select()
    .from(s.groups)
    .where(and(eq(s.groups.id, groupId), eq(s.groups.courseId, courseId)))
    .for("update");
  if (!course || !group || (!admin && course.instructorId !== actorId))
    throw new ClosureError("NOT_FOUND", "El grupo no está disponible.");
  const now = clock();
  if (!admin && now < course.startsAt)
    throw new ClosureError(
      "FORBIDDEN",
      "El cierre se habilita desde el inicio oficial.",
    );
  const [state] = await tx
    .select()
    .from(s.academicGroupStates)
    .where(eq(s.academicGroupStates.groupId, groupId))
    .for("update");
  return {
    course,
    group,
    actor,
    admin,
    now,
    state: state ?? { groupId, revision: 0, closed: false, lastVersion: 0 },
  };
}
export class DrizzleClosureRepository implements ClosureRepository {
  constructor(
    private readonly db: AttendanceDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  async getGroup(
    actorId: string,
    courseId: string,
    groupId: string,
  ): Promise<ClosureStateDto> {
    return this.db.transaction(async (tx) => {
      const ctx = await context(tx, actorId, courseId, groupId, this.clock);
      const versions = await tx
        .select()
        .from(s.academicClosureVersions)
        .where(eq(s.academicClosureVersions.groupId, groupId))
        .orderBy(desc(s.academicClosureVersions.version));
      const reopenings = await tx
        .select({
          reopening: s.academicGroupReopenings,
          version: s.academicClosureVersions.version,
        })
        .from(s.academicGroupReopenings)
        .innerJoin(
          s.academicClosureVersions,
          eq(s.academicClosureVersions.id, s.academicGroupReopenings.versionId),
        )
        .where(eq(s.academicClosureVersions.groupId, groupId))
        .orderBy(desc(s.academicClosureVersions.version));
      const current = versions.find((v) => v.version === ctx.state.lastVersion);
      if (ctx.state.closed && !current)
        throw new Error("Closure version unavailable");
      const report = ctx.state.closed
        ? null
        : await buildClosureReport(tx, ctx.course, ctx.group, ctx.now, actorId);
      const blockers = report ? closureBlockers(report, ctx.now) : [];
      return {
        courseId,
        groupId,
        status: ctx.state.closed ? "CLOSED" : "OPEN",
        revision: ctx.state.revision,
        canClose: !ctx.state.closed && blockers.length === 0,
        canReopen: ctx.admin && ctx.state.closed,
        blockers,
        official:
          ctx.state.closed && current
            ? {
                ...closureVersionDto(current),
                report: privateClosureReport(current.report, ctx.admin),
              }
            : null,
        provisional: report ? privateClosureReport(report, ctx.admin) : null,
        history: versions.map((row) => ({
          id: row.id,
          version: row.version,
          closedAt: row.closedAt.toISOString(),
          actorId: row.actorId,
          actorName: row.actorName,
        })),
        reopenings: reopenings.map(({ reopening: r, version }) => ({
          version,
          reopenedAt: r.reopenedAt.toISOString(),
          actorId: r.actorId,
          actorName: r.actorName,
          reason: r.reason,
        })),
      };
    });
  }
  async getVersion(
    actorId: string,
    courseId: string,
    groupId: string,
    version: number,
  ) {
    if (!Number.isSafeInteger(version) || version < 1)
      throw new ClosureError("VALIDATION_FAILED", "Versión no válida.");
    return this.db.transaction(async (tx) => {
      const ctx = await context(tx, actorId, courseId, groupId, this.clock);
      const [row] = await tx
        .select()
        .from(s.academicClosureVersions)
        .where(
          and(
            eq(s.academicClosureVersions.groupId, groupId),
            eq(s.academicClosureVersions.version, version),
          ),
        );
      if (!row)
        throw new ClosureError("NOT_FOUND", "La versión no está disponible.");
      return {
        ...closureVersionDto(row),
        report: privateClosureReport(row.report, ctx.admin),
      };
    });
  }
  private async mutate(
    actorId: string,
    input: ClosureCommand | ReopenGroupInput,
    operation: "CLOSE" | "REOPEN",
  ): Promise<ClosureCommandResult> {
    validateClosureCommand(input);
    if (operation === "REOPEN") validateReopen(input as ReopenGroupInput);
    return this.db.transaction(async (tx) => {
      const ctx = await context(
        tx,
        actorId,
        input.courseId,
        input.groupId,
        this.clock,
        operation === "REOPEN",
      );
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            operation,
            courseId: input.courseId,
            groupId: input.groupId,
            revision: input.revision,
            reason: "reason" in input ? input.reason.trim() : null,
          }),
        )
        .digest("hex");
      const [receipt] = await tx
        .select()
        .from(s.academicClosureReceipts)
        .where(
          and(
            eq(s.academicClosureReceipts.actorId, actorId),
            eq(s.academicClosureReceipts.requestKey, input.requestKey),
          ),
        );
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new ClosureError(
            "IDEMPOTENCY_CONFLICT",
            "La clave ya se usó con otros datos.",
          );
        return receipt.result;
      }
      if (input.revision !== ctx.state.revision)
        throw new ClosureError(
          "CONCURRENT_UPDATE",
          "El grupo cambió. Recarga antes de continuar.",
          { revision: "Recarga el estado vigente." },
        );
      let versionId: string;
      const revision = ctx.state.revision + 1;
      const version = ctx.state.lastVersion + (operation === "CLOSE" ? 1 : 0);
      if (operation === "CLOSE") {
        if (ctx.state.closed)
          throw new ClosureError("GROUP_CLOSED", "El grupo ya está cerrado.");
        const report = await buildClosureReport(
          tx,
          ctx.course,
          ctx.group,
          ctx.now,
          actorId,
        );
        const blockers = closureBlockers(report, ctx.now);
        if (blockers.length)
          throw new ClosureError(
            "CLOSURE_BLOCKED",
            "Completa sesiones, notas y asistencia antes de cerrar.",
            Object.fromEntries(blockers.map((blocker) => [blocker, blocker])),
          );
        const [row] = await tx
          .insert(s.academicClosureVersions)
          .values({
            courseId: input.courseId,
            groupId: input.groupId,
            version,
            closedAt: ctx.now,
            actorId,
            actorName: ctx.actor.name,
            report,
          })
          .returning();
        if (!row) throw new Error("Closure insert failed");
        versionId = row.id;
      } else {
        if (!ctx.state.closed)
          throw new ClosureError("GROUP_OPEN", "El grupo ya está abierto.");
        const [row] = await tx
          .select()
          .from(s.academicClosureVersions)
          .where(
            and(
              eq(s.academicClosureVersions.groupId, input.groupId),
              eq(s.academicClosureVersions.version, version),
            ),
          );
        if (!row) throw new Error("Closure version unavailable");
        versionId = row.id;
        await tx.insert(s.academicGroupReopenings).values({
          versionId,
          reopenedAt: ctx.now,
          actorId,
          actorName: ctx.actor.name,
          reason: (input as ReopenGroupInput).reason.trim(),
        });
      }
      const closed = operation === "CLOSE";
      await tx
        .insert(s.academicGroupStates)
        .values({
          groupId: input.groupId,
          closed,
          revision,
          lastVersion: version,
        })
        .onConflictDoUpdate({
          target: s.academicGroupStates.groupId,
          set: { closed, revision, lastVersion: version },
        });
      const result: ClosureCommandResult = {
        groupId: input.groupId,
        status: closed ? "CLOSED" : "OPEN",
        revision,
        version,
        versionId,
      };
      await tx
        .insert(s.academicClosureReceipts)
        .values({ actorId, requestKey: input.requestKey, fingerprint, result });
      await tx.insert(s.auditEvents).values({
        actorId,
        entityType: "GROUP",
        entityId: input.groupId,
        action: closed ? "ACADEMIC_GROUP_CLOSED" : "ACADEMIC_GROUP_REOPENED",
        metadata: {
          courseId: input.courseId,
          versionId,
          version,
          revision,
          actorName: ctx.actor.name,
          ...("reason" in input ? { reason: input.reason.trim() } : {}),
        },
      });
      return result;
    });
  }
  close(actorId: string, input: ClosureCommand) {
    return this.mutate(actorId, input, "CLOSE");
  }
  reopen(actorId: string, input: ReopenGroupInput) {
    return this.mutate(actorId, input, "REOPEN");
  }
}
