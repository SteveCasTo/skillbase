import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "@/server/db/schema";
import type { EvaluationRepository } from "@/application/evaluations/evaluation-repository";
import {
  validateSaveGrade,
  validateSaveRow,
  validateSaveScheme,
} from "@/application/evaluations/manage-evaluations";
import {
  EvaluationError,
  evaluationDecimal,
  evaluationHundredths,
  evaluationId,
  evaluationModality,
  evaluationResult,
} from "@/domain/evaluations/rules";
import type {
  CourseEvaluationsDto,
  EvaluationCommand,
  EvaluationCommandResult,
  SaveEvaluationGradeInput,
  SaveEvaluationRowInput,
  SaveEvaluationSchemeInput,
} from "@/domain/evaluations/types";
import { membershipStatus } from "@/domain/pre-registrations/policies";
import { lockInstructorSchedules } from "./instructor-schedule";
import { registrationGroupName } from "./registration-support";

type Database = PostgresJsDatabase<typeof s>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function context(
  tx: Transaction,
  actorId: string,
  courseId: string,
  clock: () => Date,
  groupId?: string,
) {
  evaluationId(actorId, "actorId");
  evaluationId(courseId, "courseId");
  // Same order/gate as assignment, membership and financial writes; never trust a stale actor.
  await lockInstructorSchedules(tx, courseId);
  const [actor] = await tx
    .select({ status: s.users.status })
    .from(s.users)
    .where(eq(s.users.id, actorId))
    .for("share");
  const roles = await tx
    .select({ code: s.userRoles.roleCode })
    .from(s.userRoles)
    .where(eq(s.userRoles.userId, actorId))
    .for("share");
  const admin = roles.some((r) => r.code === "ADMIN");
  if (
    !actor ||
    actor.status !== "ACTIVE" ||
    (!admin && !roles.some((r) => r.code === "INSTRUCTOR"))
  )
    throw new EvaluationError(
      "FORBIDDEN",
      "La cuenta no tiene autorización vigente.",
    );
  const [course] = await tx
    .select()
    .from(s.courses)
    .where(eq(s.courses.id, courseId))
    .for("update");
  if (!course || (!admin && course.instructorId !== actorId))
    throw new EvaluationError("NOT_FOUND", "El curso no está disponible.");
  if (groupId !== undefined) {
    evaluationId(groupId, "groupId");
    const [group] = await tx
      .select({ id: s.groups.id })
      .from(s.groups)
      .where(and(eq(s.groups.id, groupId), eq(s.groups.courseId, courseId)))
      .for("share");
    if (!group)
      throw new EvaluationError("NOT_FOUND", "El grupo no está disponible.");
  }
  const now = clock();
  if (!admin && now < course.startsAt)
    throw new EvaluationError(
      "FORBIDDEN",
      "Las evaluaciones se habilitan desde el inicio oficial del curso.",
    );
  const [scheme] = await tx
    .select()
    .from(s.evaluationSchemes)
    .where(eq(s.evaluationSchemes.courseId, courseId))
    .for("update");
  return { course, scheme, now, admin };
}
async function components(tx: Transaction, courseId: string) {
  return tx
    .select()
    .from(s.evaluationComponents)
    .where(eq(s.evaluationComponents.courseId, courseId))
    .orderBy(asc(s.evaluationComponents.order));
}
async function roster(
  tx: Transaction,
  course: typeof s.courses.$inferSelect,
  now: Date,
) {
  const rows = await tx
    .select({
      id: s.preRegistrations.id,
      participantId: s.preRegistrations.participantId,
      groupId: s.preRegistrations.groupId,
      state: s.preRegistrations.state,
      firstName: s.participants.firstName,
      lastName: s.participants.lastName,
      balance: sql<string>`${s.preRegistrations.totalPriceCents} - coalesce((select sum(l.amount_cents) from public.registration_ledger l where l.registration_id = ${s.preRegistrations.id} and l.kind = 'PAYMENT' and l.recorded_at <= ${now.toISOString()}::timestamptz), 0)`,
    })
    .from(s.preRegistrations)
    .innerJoin(
      s.participants,
      eq(s.participants.id, s.preRegistrations.participantId),
    )
    .where(eq(s.preRegistrations.courseId, course.id))
    .orderBy(
      asc(s.preRegistrations.state),
      desc(s.preRegistrations.createdAt),
      desc(s.preRegistrations.id),
    );
  const selected = new Map<string, (typeof rows)[number]>();
  for (const row of rows)
    if (!selected.has(row.participantId)) selected.set(row.participantId, row);
  return [...selected.values()].map((row) => ({
    ...row,
    membershipStatus: membershipStatus(
      row.state,
      Number(row.balance),
      course.startsAt,
      now,
    ),
  }));
}
function assertSchemeRevision(actual: number, expected: number) {
  if (actual !== expected)
    throw new EvaluationError(
      "CONCURRENT_UPDATE",
      "El esquema cambió. Recarga antes de guardar.",
      { schemeRevision: "Recarga el esquema vigente." },
    );
}
export class DrizzleEvaluationRepository implements EvaluationRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  async getCourse(
    actorId: string,
    courseId: string,
    groupId?: string,
  ): Promise<CourseEvaluationsDto> {
    return this.db.transaction(async (tx) => {
      const ctx = await context(tx, actorId, courseId, this.clock, groupId);
      const items = await components(tx, courseId);
      const gradeRows = await tx
        .select({ grade: s.evaluationGrades, actorName: s.users.name })
        .from(s.evaluationGrades)
        .leftJoin(s.users, eq(s.users.id, s.evaluationGrades.recordedBy))
        .where(eq(s.evaluationGrades.courseId, courseId));
      const grades = gradeRows.map((r) => ({
        ...r.grade,
        actorName: r.actorName,
      }));
      const groups = await tx
        .select()
        .from(s.groups)
        .where(eq(s.groups.courseId, courseId))
        .orderBy(asc(s.groups.startsAt), asc(s.groups.id));
      const people = await roster(tx, ctx.course, ctx.now);
      const historyRows = ctx.admin
        ? await tx
            .select({
              metadata: s.auditEvents.metadata,
              actorName: s.users.name,
              recordedAt: s.auditEvents.createdAt,
            })
            .from(s.auditEvents)
            .leftJoin(s.users, eq(s.users.id, s.auditEvents.actorId))
            .where(
              and(
                eq(s.auditEvents.entityId, courseId),
                eq(s.auditEvents.entityType, "COURSE"),
                eq(s.auditEvents.action, "EVALUATION_GRADE_RECORDED"),
              ),
            )
            .orderBy(desc(s.auditEvents.createdAt), desc(s.auditEvents.id))
        : [];
      const visiblePeople = people.filter(
        (p) =>
          (groupId === undefined || p.groupId === groupId) &&
          (p.membershipStatus === "INSCRITO" ||
            grades.some((g) => g.participantId === p.participantId)),
      );
      return {
        courseId,
        courseName: ctx.course.name,
        startsAt: ctx.course.startsAt.toISOString(),
        minimumGrade: ctx.course.minimumGrade,
        provisional: true,
        ...(groupId === undefined ? {} : { groupId }),
        unavailableReason: null,
        history: historyRows.flatMap((h) => {
          const m = h.metadata;
          if (
            typeof m.participantId !== "string" ||
            !visiblePeople.some((p) => p.participantId === m.participantId) ||
            typeof m.componentId !== "string" ||
            typeof m.toHundredths !== "number" ||
            typeof m.revision !== "number"
          )
            return [];
          return [
            {
              participantId: m.participantId,
              componentId: m.componentId,
              fromScore:
                typeof m.fromHundredths === "number"
                  ? evaluationDecimal(m.fromHundredths)
                  : null,
              toScore: evaluationDecimal(m.toHundredths),
              revision: m.revision,
              actorName: h.actorName,
              recordedAt: h.recordedAt.toISOString(),
            },
          ];
        }),
        scheme: {
          revision: ctx.scheme?.revision ?? 0,
          frozenAt: ctx.scheme?.frozenAt?.toISOString() ?? null,
          modality: evaluationModality(items.map((c) => c.type)),
          canEdit: !ctx.scheme?.frozenAt,
          components: items.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            weight: evaluationDecimal(c.weightHundredths),
            order: c.order,
          })),
        },
        groups: groups.map((g) => ({
          id: g.id,
          label: registrationGroupName(g),
        })),
        participants: visiblePeople
          .sort(
            (a, b) =>
              a.lastName.localeCompare(b.lastName) ||
              a.firstName.localeCompare(b.firstName) ||
              a.participantId.localeCompare(b.participantId),
          )
          .map((p) => {
            const marks = grades.filter(
              (g) => g.participantId === p.participantId,
            );
            return {
              participantId: p.participantId,
              registrationId: p.id,
              groupId: p.groupId,
              firstName: p.firstName,
              lastName: p.lastName,
              membershipStatus: p.membershipStatus,
              canGrade: p.membershipStatus === "INSCRITO" && items.length > 0,
              grades: items.map((c) => {
                const g = marks.find((m) => m.componentId === c.id);
                return {
                  componentId: c.id,
                  score: g ? evaluationDecimal(g.scoreHundredths) : null,
                  revision: g?.revision ?? 0,
                  recordedBy: ctx.admin ? (g?.recordedBy ?? null) : null,
                  recordedByName: g?.actorName ?? null,
                  recordedAt: g?.recordedAt.toISOString() ?? null,
                };
              }),
              result: evaluationResult(items, marks, ctx.course.minimumGrade),
            };
          }),
      };
    });
  }
  private async command(
    tx: Transaction,
    actorId: string,
    input: EvaluationCommand,
    operation: string,
    payload: unknown,
    work: () => Promise<EvaluationCommandResult>,
  ): Promise<EvaluationCommandResult> {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ operation, payload }))
      .digest("hex");
    const [receipt] = await tx
      .select()
      .from(s.evaluationCommandReceipts)
      .where(
        and(
          eq(s.evaluationCommandReceipts.actorId, actorId),
          eq(s.evaluationCommandReceipts.requestKey, input.requestKey),
        ),
      );
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        throw new EvaluationError(
          "IDEMPOTENCY_CONFLICT",
          "La clave ya se usó con otros datos.",
        );
      return receipt.result;
    }
    const result = await work();
    await tx
      .insert(s.evaluationCommandReceipts)
      .values({ actorId, requestKey: input.requestKey, fingerprint, result });
    return result;
  }
  async saveScheme(actorId: string, input: SaveEvaluationSchemeInput) {
    validateSaveScheme(input);
    return this.db.transaction(async (tx) => {
      const ctx = await context(
        tx,
        actorId,
        input.courseId,
        this.clock,
        input.groupId,
      );
      return this.command(tx, actorId, input, "SCHEME", input, async () => {
        assertSchemeRevision(ctx.scheme?.revision ?? 0, input.schemeRevision);
        if (ctx.scheme?.frozenAt)
          throw new EvaluationError(
            "SCHEME_FROZEN",
            "El esquema quedó congelado al registrar la primera nota.",
          );
        const previousComponents = await components(tx, input.courseId);
        const revision = input.schemeRevision + 1;
        await tx
          .insert(s.evaluationSchemes)
          .values({
            courseId: input.courseId,
            revision,
            updatedBy: actorId,
            updatedAt: ctx.now,
          })
          .onConflictDoUpdate({
            target: s.evaluationSchemes.courseId,
            set: { revision, updatedBy: actorId, updatedAt: ctx.now },
          });
        await tx
          .delete(s.evaluationComponents)
          .where(eq(s.evaluationComponents.courseId, input.courseId));
        await tx.insert(s.evaluationComponents).values(
          input.components.map((c, order) => ({
            id: c.id,
            courseId: input.courseId,
            name: c.name.trim(),
            type: c.type,
            weightHundredths: evaluationHundredths(c.weight, "weight"),
            order,
          })),
        );
        await tx.insert(s.auditEvents).values({
          actorId,
          entityType: "COURSE",
          entityId: input.courseId,
          action: "EVALUATION_SCHEME_SAVED",
          metadata: {
            revision,
            previousComponents: JSON.stringify(
              previousComponents.map((c) => ({
                id: c.id,
                name: c.name,
                type: c.type,
                weight: evaluationDecimal(c.weightHundredths),
              })),
            ),
            components: JSON.stringify(
              input.components.map((c) => ({
                id: c.id,
                name: c.name.trim(),
                type: c.type,
                weight: evaluationDecimal(
                  evaluationHundredths(c.weight, "weight"),
                ),
              })),
            ),
          },
        });
        return { kind: "scheme", schemeRevision: revision };
      });
    });
  }
  async saveRow(actorId: string, input: SaveEvaluationRowInput) {
    validateSaveRow(input);
    return this.db.transaction(async (tx) => {
      const ctx = await context(
        tx,
        actorId,
        input.courseId,
        this.clock,
        input.groupId,
      );
      return this.command(tx, actorId, input, "ROW", input, async () => {
        assertSchemeRevision(ctx.scheme?.revision ?? 0, input.schemeRevision);
        const items = await components(tx, input.courseId);
        const person = (await roster(tx, ctx.course, ctx.now)).find(
          (p) => p.id === input.registrationId,
        );
        if (
          !person ||
          person.membershipStatus !== "INSCRITO" ||
          (input.groupId !== undefined && person.groupId !== input.groupId)
        )
          throw new EvaluationError(
            "NOT_ENROLLED",
            "Solo participantes inscritos pueden recibir notas.",
          );
        const previous = await tx
          .select()
          .from(s.evaluationGrades)
          .where(
            and(
              eq(s.evaluationGrades.courseId, input.courseId),
              eq(s.evaluationGrades.participantId, person.participantId),
            ),
          )
          .for("update");
        // Validate the entire observed row before any write, including the first-note freeze.
        const changes = input.grades
          .map((grade, index) => {
            const componentId = evaluationId(
              grade.componentId,
              `grades.${index}.componentId`,
            );
            if (!items.some((c) => c.id === componentId))
              throw new EvaluationError(
                "NOT_FOUND",
                "El componente no está disponible.",
              );
            const old = previous.find((g) => g.componentId === componentId);
            if ((old?.revision ?? 0) !== grade.gradeRevision)
              throw new EvaluationError(
                "CONCURRENT_UPDATE",
                "La nota cambió. Recarga antes de guardar.",
                {
                  [`grades.${index}.gradeRevision`]: "Recarga la nota vigente.",
                },
              );
            return {
              componentId,
              old,
              scoreHundredths: evaluationHundredths(
                grade.score,
                `grades.${index}.score`,
              ),
              revision: grade.gradeRevision + 1,
            };
          })
          .filter(
            (change) => change.old?.scoreHundredths !== change.scoreHundredths,
          );
        for (const change of changes) {
          const value = {
            scoreHundredths: change.scoreHundredths,
            revision: change.revision,
            recordedBy: actorId,
            recordedAt: ctx.now,
          };
          if (change.old)
            await tx
              .update(s.evaluationGrades)
              .set(value)
              .where(
                and(
                  eq(s.evaluationGrades.courseId, input.courseId),
                  eq(s.evaluationGrades.participantId, person.participantId),
                  eq(s.evaluationGrades.componentId, change.componentId),
                ),
              );
          else
            await tx.insert(s.evaluationGrades).values({
              ...value,
              courseId: input.courseId,
              participantId: person.participantId,
              registrationId: person.id,
              componentId: change.componentId,
            });
        }
        const marks = await tx
          .select({ grade: s.evaluationGrades, actorName: s.users.name })
          .from(s.evaluationGrades)
          .leftJoin(s.users, eq(s.users.id, s.evaluationGrades.recordedBy))
          .where(
            and(
              eq(s.evaluationGrades.courseId, input.courseId),
              eq(s.evaluationGrades.participantId, person.participantId),
            ),
          );
        const [scheme] = await tx
          .select()
          .from(s.evaluationSchemes)
          .where(eq(s.evaluationSchemes.courseId, input.courseId));
        if (!scheme) throw new Error("Evaluation scheme unavailable");
        return {
          kind: "row",
          schemeRevision: scheme.revision,
          participantId: person.participantId,
          registrationId: person.id,
          grades: items.map((item) => {
            const mark = marks.find((m) => m.grade.componentId === item.id);
            return {
              componentId: item.id,
              score: mark
                ? evaluationDecimal(mark.grade.scoreHundredths)
                : null,
              revision: mark?.grade.revision ?? 0,
              recordedBy: mark?.grade.recordedBy ?? null,
              recordedByName: mark?.actorName ?? null,
              recordedAt: mark?.grade.recordedAt.toISOString() ?? null,
            };
          }),
          result: evaluationResult(
            items,
            marks.map((m) => m.grade),
            ctx.course.minimumGrade,
          ),
        };
      });
    });
  }
  async saveGrade(actorId: string, input: SaveEvaluationGradeInput) {
    validateSaveGrade(input);
    return this.db.transaction(async (tx) => {
      const ctx = await context(
        tx,
        actorId,
        input.courseId,
        this.clock,
        input.groupId,
      );
      return this.command(tx, actorId, input, "GRADE", input, async () => {
        assertSchemeRevision(ctx.scheme?.revision ?? 0, input.schemeRevision);
        const items = await components(tx, input.courseId);
        if (!items.some((c) => c.id === input.componentId))
          throw new EvaluationError(
            "NOT_FOUND",
            "El componente no está disponible.",
          );
        const person = (await roster(tx, ctx.course, ctx.now)).find(
          (p) => p.id === input.registrationId,
        );
        if (
          !person ||
          person.membershipStatus !== "INSCRITO" ||
          (input.groupId !== undefined && person.groupId !== input.groupId)
        )
          throw new EvaluationError(
            "NOT_ENROLLED",
            "Solo participantes inscritos pueden recibir notas.",
            {
              registrationId:
                "Selecciona una inscripción vigente del curso y grupo.",
            },
          );
        const [previous] = await tx
          .select()
          .from(s.evaluationGrades)
          .where(
            and(
              eq(s.evaluationGrades.courseId, input.courseId),
              eq(s.evaluationGrades.participantId, person.participantId),
              eq(s.evaluationGrades.componentId, input.componentId),
            ),
          )
          .for("update");
        if ((previous?.revision ?? 0) !== input.gradeRevision)
          throw new EvaluationError(
            "CONCURRENT_UPDATE",
            "La nota cambió. Recarga antes de guardar.",
            { gradeRevision: "Recarga la nota vigente." },
          );
        const revision = input.gradeRevision + 1;
        const value = {
          scoreHundredths: evaluationHundredths(input.score, "score"),
          revision,
          recordedBy: actorId,
          recordedAt: ctx.now,
        };
        if (previous)
          await tx
            .update(s.evaluationGrades)
            .set(value)
            .where(
              and(
                eq(s.evaluationGrades.courseId, input.courseId),
                eq(s.evaluationGrades.participantId, person.participantId),
                eq(s.evaluationGrades.componentId, input.componentId),
              ),
            );
        else
          await tx.insert(s.evaluationGrades).values({
            ...value,
            courseId: input.courseId,
            participantId: person.participantId,
            registrationId: person.id,
            componentId: input.componentId,
          });
        const marks = await tx
          .select()
          .from(s.evaluationGrades)
          .where(
            and(
              eq(s.evaluationGrades.courseId, input.courseId),
              eq(s.evaluationGrades.participantId, person.participantId),
            ),
          );
        const [scheme] = await tx
          .select()
          .from(s.evaluationSchemes)
          .where(eq(s.evaluationSchemes.courseId, input.courseId));
        if (!scheme) throw new Error("Evaluation scheme unavailable");
        return {
          kind: "grade",
          schemeRevision: scheme.revision,
          participantId: person.participantId,
          componentId: input.componentId,
          gradeRevision: revision,
          result: evaluationResult(items, marks, ctx.course.minimumGrade),
        };
      });
    });
  }
}
