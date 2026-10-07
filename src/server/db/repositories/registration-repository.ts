import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { RegistrationRepository } from "@/application/pre-registrations/registration-repository";
import {
  validateMutation,
  validateRegistrationFilter,
  validateRegistrationReason,
} from "@/application/pre-registrations/manage-registrations";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import {
  assertRefund,
  registrationFinance,
} from "@/domain/pre-registrations/finance";
import {
  createPriceSnapshot,
  validateSettings,
} from "@/domain/pre-registrations/money";
import { validateParticipant } from "@/domain/pre-registrations/participant";
import {
  assertAdditionalPayment,
  assertAcademicRegistrationDestination,
  assertCancellation,
  assertEligibleDestination,
  assertRegistrationPayment,
  assertTransfer,
} from "@/domain/pre-registrations/policies";
import { validateCashEffectiveDate } from "@/domain/pre-registrations/time";
import {
  validateCashInput,
  validateCreateRegistration,
  validateRegistrationId,
  validateRegistrationRevision,
} from "@/domain/pre-registrations/validation";
import type {
  AdminRegistrationDto,
  CancelRegistrationInput,
  CashInput,
  CreateRegistrationInput,
  LedgerEntryDto,
  RecordCashInput,
  RegistrationDetailDto,
  RegistrationFilter,
  RegistrationSettings,
  TransferRegistrationInput,
  UpdateParticipantInput,
  UpdateRegistrationSettingsInput,
} from "@/domain/pre-registrations/types";
import { getDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { lockInstructorSchedules } from "./instructor-schedule";
import { academicGroupClosed } from "./academic-closure-guard";
import {
  assertFreshRevision,
  courseContext,
  ledgerEntries,
  ledgerDto,
  nextRegistrationVersion,
  occupiedSeats,
  participantDto,
  priceDto,
  registrationAudit,
  registrationDto,
  registrationGroupName,
  requireFreshRegistrationActor,
  type RegistrationDatabase,
  type RegistrationRow,
  type RegistrationTransaction,
} from "./registration-support";

type Receipt = typeof schema.registrationCommandReceipts.$inferInsert;
type PendingCash = typeof schema.registrationLedger.$inferInsert;
type CommandResult = Receipt["result"];
/** Recursively stable keys; callers supply only explicitly validated contract fields. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export class DrizzleRegistrationRepository implements RegistrationRepository {
  constructor(
    private readonly db: RegistrationDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async read<T>(
    actorId: string,
    work: (tx: RegistrationTransaction, now: Date) => Promise<T>,
    role: "ADMIN" | "INSTRUCTOR" = "ADMIN",
  ): Promise<T> {
    validateRegistrationId(actorId, "actorId");
    return this.db.transaction(async (tx) => {
      await lockInstructorSchedules(tx);
      await requireFreshRegistrationActor(tx, actorId, role);
      return work(tx, this.clock());
    });
  }
  private async command<T extends CommandResult>(
    actorId: string,
    requestKey: string,
    operation: Receipt["operation"],
    payload: unknown,
    work: (
      tx: RegistrationTransaction,
      now: Date,
      receiptId: string,
    ) => Promise<{ result: T; cash?: PendingCash }>,
  ): Promise<T> {
    validateRegistrationId(actorId, "actorId");
    validateRegistrationId(requestKey, "requestKey");
    const fingerprint = createHash("sha256")
      .update(canonical({ operation, payload }))
      .digest("hex");
    return this.db.transaction(async (tx) => {
      await lockInstructorSchedules(tx);
      await requireFreshRegistrationActor(tx, actorId);
      const [previous] = await tx
        .select()
        .from(schema.registrationCommandReceipts)
        .where(
          and(
            eq(schema.registrationCommandReceipts.actorId, actorId),
            eq(schema.registrationCommandReceipts.requestKey, requestKey),
          ),
        );
      if (previous) {
        if (
          previous.operation !== operation ||
          previous.fingerprint !== fingerprint
        )
          throw new RegistrationError(
            "IDEMPOTENCY_CONFLICT",
            "La clave ya corresponde a otra solicitud. Usa una clave nueva para datos distintos.",
          );
        // Operation + fingerprint bind this stored server-produced result to the exact command.
        return previous.result as T;
      }
      const now = this.clock();
      const receiptId = randomUUID();
      const { result, cash } = await work(tx, now, receiptId);
      await tx.insert(schema.registrationCommandReceipts).values({
        id: receiptId,
        actorId,
        requestKey,
        operation,
        fingerprint,
        result,
        recordedAt: now,
      });
      if (cash) await tx.insert(schema.registrationLedger).values(cash);
      return result;
    });
  }
  private async currentSettings(
    tx: RegistrationTransaction,
  ): Promise<RegistrationSettings> {
    await tx
      .insert(schema.registrationSettings)
      .values({ id: 1 })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(schema.registrationSettings)
      .where(eq(schema.registrationSettings.id, 1))
      .for("update");
    if (!row)
      throw new RegistrationError(
        "NOT_FOUND",
        "La configuración no está disponible.",
      );
    return {
      minimumPaymentPercent: row.minimumPaymentPercent,
      auxiliaryDiscountPercent: row.auxiliaryDiscountPercent,
      revision: row.revision,
    };
  }
  private cash(
    input: CashInput,
    registrationId: string,
    actorId: string,
    receiptId: string,
    kind: "PAYMENT" | "REFUND",
    now: Date,
  ): { row: PendingCash; dto: LedgerEntryDto } {
    const normalized = validateCashInput(input, now, kind !== "PAYMENT");
    const id = randomUUID();
    const effectiveDate = validateCashEffectiveDate(
      normalized.effectiveDate,
      now,
    );
    return {
      row: {
        id,
        registrationId,
        commandReceiptId: receiptId,
        kind,
        amountCents: String(normalized.amountCents),
        effectiveDate,
        actorId,
        reason: normalized.reason ?? "",
        recordedAt: now,
      },
      dto: {
        id,
        kind,
        amountCents: normalized.amountCents,
        effectiveDate,
        actorId,
        reason: normalized.reason ?? null,
        recordedAt: now.toISOString(),
      },
    };
  }
  private async lockedRegistration(
    tx: RegistrationTransaction,
    id: string,
    destinationId?: string,
  ) {
    const [reference] = await tx
      .select({
        courseId: schema.preRegistrations.courseId,
        groupId: schema.preRegistrations.groupId,
      })
      .from(schema.preRegistrations)
      .where(eq(schema.preRegistrations.id, id));
    if (!reference)
      throw new RegistrationError("NOT_FOUND", "El registro no existe.");
    await lockInstructorSchedules(tx, reference.courseId);
    const course = await courseContext(tx, reference.courseId, true);
    const ids = [
      ...new Set([
        reference.groupId,
        ...(destinationId ? [destinationId] : []),
      ]),
    ].sort();
    const groups = await tx
      .select()
      .from(schema.groups)
      .where(inArray(schema.groups.id, ids))
      .orderBy(asc(schema.groups.id))
      .for("update");
    const [row] = await tx
      .select()
      .from(schema.preRegistrations)
      .where(eq(schema.preRegistrations.id, id))
      .for("update");
    if (!row)
      throw new RegistrationError("NOT_FOUND", "El registro no existe.");
    return { row, groups, ...course };
  }
  async form(courseId: string, actorId: string, sourceInterestId?: string) {
    validateRegistrationId(courseId, "courseId");
    if (sourceInterestId)
      validateRegistrationId(sourceInterestId, "sourceInterestId");
    return this.read(actorId, async (tx) => {
      const [exists] = await tx
        .select({ id: schema.courses.id })
        .from(schema.courses)
        .where(eq(schema.courses.id, courseId));
      if (!exists) return null;
      const { course, context } = await courseContext(tx, courseId);
      const groups = await tx
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.courseId, courseId))
        .orderBy(asc(schema.groups.startsAt), asc(schema.groups.id));
      const [interest] = sourceInterestId
        ? await tx
            .select()
            .from(schema.interestRegistrations)
            .where(
              and(
                eq(schema.interestRegistrations.id, sourceInterestId),
                eq(schema.interestRegistrations.courseId, courseId),
                eq(schema.interestRegistrations.status, "ACTIVE"),
                sql`not exists (select 1 from pre_registrations where source_interest_id = ${sourceInterestId}::uuid)`,
              ),
            )
        : [];
      if (sourceInterestId && !interest)
        throw new RegistrationError(
          "NOT_FOUND",
          "El interesado no pertenece al curso o ya fue usado en un registro.",
        );
      return {
        course: {
          id: course.id,
          name: course.name,
          revision: course.updatedAt.toISOString(),
          status: course.status,
          startsAt: course.startsAt.toISOString(),
          registrationEndAt: course.registrationEndAt?.toISOString() ?? null,
          courseTypeRevisionId: context.courseTypeRevisionId,
          studentAmount: context.studentAmount,
          externalAmount: context.externalAmount,
          instructorActive: context.instructorActive,
        },
        groups: await Promise.all(
          groups.map(async (group) => ({
            id: group.id,
            groupName: registrationGroupName(group),
            startsAt: group.startsAt.toISOString(),
            endsAt: group.endsAt.toISOString(),
            capacity: group.capacity,
            occupied: await occupiedSeats(tx, group.id),
            status: group.status,
          })),
        ),
        settings: await this.currentSettings(tx),
        sourceInterest: interest
          ? {
              id: interest.id,
              firstName: interest.firstName,
              lastName: interest.lastName,
              email: interest.email,
              phone: interest.phone,
            }
          : null,
      };
    });
  }
  async create(
    raw: CreateRegistrationInput,
    actorId: string,
  ): Promise<AdminRegistrationDto> {
    const input = validateCreateRegistration(raw, this.clock());
    return this.command(
      actorId,
      input.requestKey,
      "CREATE",
      input,
      async (tx, now, receiptId) => {
        await lockInstructorSchedules(tx, input.courseId);
        const { course, context } = await courseContext(
          tx,
          input.courseId,
          true,
        );
        assertFreshRevision(course.updatedAt, input.courseRevision);
        const [group] = await tx
          .select()
          .from(schema.groups)
          .where(eq(schema.groups.id, input.groupId))
          .for("update");
        if (!group)
          throw new RegistrationError(
            "GROUP_UNAVAILABLE",
            "El grupo no existe.",
          );
        assertEligibleDestination(context, {
          ...group,
          occupied: await occupiedSeats(tx, group.id),
        });
        // Receipt replay happens before this work. New commands inspect the
        // target under the same schedule/course/group locks as academic close,
        // before creating a participant, registration, receipt or cash movement.
        assertAcademicRegistrationDestination(
          await academicGroupClosed(tx, group.id),
        );
        const settings = await this.currentSettings(tx);
        if (settings.revision !== input.settingsRevision)
          throw new RegistrationError(
            "CONCURRENT_UPDATE",
            "Cambió la configuración. Revisa el precio y el mínimo.",
          );
        const price = createPriceSnapshot({
          ...context,
          participantType: input.participantType,
          settings,
        });
        assertRegistrationPayment(
          context,
          price,
          input.initialPayment?.amountCents ?? null,
          input.firstDayException,
          now,
        );
        if (input.sourceInterestId) {
          const [interest] = await tx
            .select({ id: schema.interestRegistrations.id })
            .from(schema.interestRegistrations)
            .where(
              and(
                eq(schema.interestRegistrations.id, input.sourceInterestId),
                eq(schema.interestRegistrations.courseId, course.id),
                eq(schema.interestRegistrations.status, "ACTIVE"),
                sql`not exists (select 1 from pre_registrations where source_interest_id = ${input.sourceInterestId}::uuid)`,
              ),
            );
          if (!interest)
            throw new RegistrationError(
              "NOT_FOUND",
              "El interesado no pertenece al curso o ya fue usado en un registro.",
            );
        }
        const [createdPerson] = await tx
          .insert(schema.participants)
          .values({ ...input.participant, createdAt: now, updatedAt: now })
          .onConflictDoNothing({ target: schema.participants.ci })
          .returning({ id: schema.participants.id });
        const [person] = await tx
          .select()
          .from(schema.participants)
          .where(eq(schema.participants.ci, input.participant.ci))
          .for("update");
        if (!person)
          throw new RegistrationError(
            "NOT_FOUND",
            "La persona no está disponible.",
          );
        if (createdPerson)
          await registrationAudit(
            tx,
            actorId,
            person.id,
            "PARTICIPANT_CREATED",
            {},
            "PARTICIPANT",
          );
        const [duplicate] = await tx
          .select({ id: schema.preRegistrations.id })
          .from(schema.preRegistrations)
          .where(
            and(
              eq(schema.preRegistrations.participantId, person.id),
              eq(schema.preRegistrations.courseId, course.id),
              eq(schema.preRegistrations.state, "ACTIVE"),
            ),
          );
        if (duplicate)
          throw new RegistrationError(
            "ACTIVE_REGISTRATION_EXISTS",
            "La persona ya tiene un registro vigente en este curso.",
            { ci: "Abre el registro existente." },
            { registrationId: duplicate.id },
          );
        if (
          person.firstName !== input.participant.firstName ||
          person.lastName !== input.participant.lastName ||
          person.email !== input.participant.email ||
          person.phone !== input.participant.phone
        )
          throw new RegistrationError(
            "PARTICIPANT_DETAILS_CONFLICT",
            "El CI corresponde a una ficha existente. Revisa y edita explícitamente la ficha global.",
            {},
            {
              participantId: person.id,
              revision: person.updatedAt.toISOString(),
            },
          );
        const [row] = await tx
          .insert(schema.preRegistrations)
          .values({
            participantId: person.id,
            courseId: course.id,
            groupId: group.id,
            courseTypeRevisionId: price.courseTypeRevisionId,
            sourceInterestId: input.sourceInterestId,
            participantType: price.participantType,
            settingsRevision: price.settingsRevision,
            basePriceCents: String(price.basePriceCents),
            discountPercent: price.discountPercent,
            totalPriceCents: String(price.totalPriceCents),
            minimumPaymentPercent: price.minimumPaymentPercent,
            minimumPaymentCents: String(price.minimumPaymentCents),
            firstDayException: input.firstDayException,
            createdBy: actorId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!row)
          throw new RegistrationError(
            "NOT_FOUND",
            "No se pudo crear el registro.",
          );
        const cash = input.initialPayment
          ? this.cash(
              input.initialPayment,
              row.id,
              actorId,
              receiptId,
              "PAYMENT",
              now,
            )
          : undefined;
        const result = await registrationDto(
          tx,
          row,
          now,
          cash ? [cash.dto] : [],
        );
        await registrationAudit(
          tx,
          actorId,
          row.id,
          "PRE_REGISTRATION_CREATED",
          {
            courseId: course.id,
            groupId: group.id,
            participantId: person.id,
            totalPriceCents: price.totalPriceCents,
            firstDayException: input.firstDayException,
          },
        );
        if (cash)
          await registrationAudit(
            tx,
            actorId,
            row.id,
            "REGISTRATION_PAYMENT_RECORDED",
            { amountCents: cash.dto.amountCents, ledgerId: cash.dto.id },
          );
        return { result, ...(cash ? { cash: cash.row } : {}) };
      },
    );
  }
  async updateParticipant(raw: UpdateParticipantInput, actorId: string) {
    const input = {
      requestKey: validateRegistrationId(raw.requestKey, "requestKey"),
      participantId: validateRegistrationId(raw.participantId, "participantId"),
      revision: validateRegistrationRevision(raw.revision),
      participant: validateParticipant(raw.participant),
    };
    return this.command(
      actorId,
      input.requestKey,
      "PARTICIPANT_UPDATE",
      input,
      async (tx, now) => {
        const [previous] = await tx
          .select()
          .from(schema.participants)
          .where(eq(schema.participants.id, input.participantId))
          .for("update");
        if (!previous)
          throw new RegistrationError("NOT_FOUND", "La persona no existe.");
        assertFreshRevision(previous.updatedAt, input.revision);
        const [duplicate] = await tx
          .select({ id: schema.participants.id })
          .from(schema.participants)
          .where(eq(schema.participants.ci, input.participant.ci));
        if (duplicate && duplicate.id !== previous.id)
          throw new RegistrationError(
            "CI_ALREADY_EXISTS",
            "El CI pertenece a otra ficha.",
            { ci: "Revisa la ficha existente; no se fusionan personas." },
          );
        const [row] = await tx
          .update(schema.participants)
          .set({
            ...input.participant,
            updatedAt: nextRegistrationVersion(previous.updatedAt, now),
          })
          .where(eq(schema.participants.id, previous.id))
          .returning();
        if (!row)
          throw new RegistrationError("NOT_FOUND", "La persona no existe.");
        await registrationAudit(
          tx,
          actorId,
          row.id,
          "PARTICIPANT_UPDATED",
          {},
          "PARTICIPANT",
        );
        return { result: participantDto(row) };
      },
    );
  }
  private async recordCash(
    raw: RecordCashInput,
    actorId: string,
    kind: "PAYMENT" | "REFUND",
  ): Promise<RegistrationDetailDto> {
    const checked = validateMutation(raw);
    const input = {
      requestKey: checked.requestKey,
      registrationId: checked.registrationId,
      revision: checked.revision,
      cash: validateCashInput(raw.cash, this.clock(), kind !== "PAYMENT"),
    };
    return this.command(
      actorId,
      input.requestKey,
      kind,
      input,
      async (tx, now, receiptId) => {
        const { row, context } = await this.lockedRegistration(
          tx,
          input.registrationId,
        );
        assertFreshRevision(row.updatedAt, input.revision);
        const entries = await ledgerEntries(tx, row.id);
        const finance = registrationFinance(priceDto(row), row.state, entries);
        if (kind === "PAYMENT")
          assertAdditionalPayment(
            row.state,
            finance,
            input.cash.amountCents,
            context.startsAt,
            now,
          );
        else assertRefund(row.state, finance, input.cash.amountCents);
        const cash = this.cash(
          input.cash,
          row.id,
          actorId,
          receiptId,
          kind,
          now,
        );
        const updated = await this.touch(tx, row, now);
        const ledger = [...entries, cash.dto];
        const result = {
          registration: await registrationDto(tx, updated, now, ledger),
          ledger,
        };
        await registrationAudit(
          tx,
          actorId,
          row.id,
          kind === "PAYMENT"
            ? "REGISTRATION_PAYMENT_RECORDED"
            : "REGISTRATION_REFUND_RECORDED",
          { ledgerId: cash.dto.id, amountCents: input.cash.amountCents },
        );
        return { result, cash: cash.row };
      },
    );
  }
  recordPayment(input: RecordCashInput, actorId: string) {
    return this.recordCash(input, actorId, "PAYMENT");
  }
  recordRefund(input: RecordCashInput, actorId: string) {
    return this.recordCash(input, actorId, "REFUND");
  }
  private async touch(
    tx: RegistrationTransaction,
    row: RegistrationRow,
    now: Date,
  ) {
    const [updated] = await tx
      .update(schema.preRegistrations)
      .set({ updatedAt: nextRegistrationVersion(row.updatedAt, now) })
      .where(eq(schema.preRegistrations.id, row.id))
      .returning();
    if (!updated)
      throw new RegistrationError("NOT_FOUND", "El registro no existe.");
    return updated;
  }
  async cancel(
    raw: CancelRegistrationInput,
    actorId: string,
  ): Promise<RegistrationDetailDto> {
    const checked = validateMutation(raw);
    const input = {
      requestKey: checked.requestKey,
      registrationId: checked.registrationId,
      revision: checked.revision,
      reason: validateRegistrationReason(raw.reason),
      refundedNow:
        raw.refundedNow === null
          ? null
          : validateCashInput(raw.refundedNow, this.clock()),
    };
    return this.command(
      actorId,
      input.requestKey,
      "CANCEL",
      input,
      async (tx, now, receiptId) => {
        const { row, context } = await this.lockedRegistration(
          tx,
          input.registrationId,
        );
        assertFreshRevision(row.updatedAt, input.revision);
        assertCancellation(context, row.state, "VOLUNTARY", now);
        const entries = await ledgerEntries(tx, row.id);
        const liability = registrationFinance(
          priceDto(row),
          "CANCELLED",
          entries,
        );
        if (input.refundedNow)
          assertRefund("CANCELLED", liability, input.refundedNow.amountCents);
        const cash = input.refundedNow
          ? this.cash(
              input.refundedNow,
              row.id,
              actorId,
              receiptId,
              "REFUND",
              now,
            )
          : undefined;
        const [updated] = await tx
          .update(schema.preRegistrations)
          .set({
            state: "CANCELLED",
            cancelledAt: now,
            cancelledBy: actorId,
            cancellationReason: "VOLUNTARY",
            cancellationNote: input.reason,
            updatedAt: nextRegistrationVersion(row.updatedAt, now),
          })
          .where(eq(schema.preRegistrations.id, row.id))
          .returning();
        if (!updated)
          throw new RegistrationError("NOT_FOUND", "El registro no existe.");
        const ledger = cash ? [...entries, cash.dto] : entries;
        const result = {
          registration: await registrationDto(tx, updated, now, ledger),
          ledger,
        };
        await registrationAudit(
          tx,
          actorId,
          row.id,
          "PRE_REGISTRATION_CANCELLED",
          {
            reason: "VOLUNTARY",
            refundDueCents: result.registration.refundDueCents,
          },
        );
        if (cash)
          await registrationAudit(
            tx,
            actorId,
            row.id,
            "REGISTRATION_REFUND_RECORDED",
            { ledgerId: cash.dto.id, amountCents: cash.dto.amountCents },
          );
        return { result, ...(cash ? { cash: cash.row } : {}) };
      },
    );
  }
  async transfer(raw: TransferRegistrationInput, actorId: string) {
    const checked = validateMutation(raw);
    const input = {
      requestKey: checked.requestKey,
      registrationId: checked.registrationId,
      revision: checked.revision,
      destinationGroupId: validateRegistrationId(
        raw.destinationGroupId,
        "destinationGroupId",
      ),
    };
    return this.command(
      actorId,
      input.requestKey,
      "TRANSFER",
      input,
      async (tx, now) => {
        const { row, context, groups } = await this.lockedRegistration(
          tx,
          input.registrationId,
          input.destinationGroupId,
        );
        assertFreshRevision(row.updatedAt, input.revision);
        const destination = groups.find(
          (group) => group.id === input.destinationGroupId,
        );
        if (!destination)
          throw new RegistrationError(
            "GROUP_UNAVAILABLE",
            "El grupo destino no existe.",
          );
        if (destination.id === row.groupId)
          throw new RegistrationError(
            "VALIDATION_FAILED",
            "Selecciona un grupo distinto.",
            { destinationGroupId: "La persona ya pertenece a este grupo." },
          );
        assertTransfer(
          context,
          row.state,
          { ...destination, occupied: await occupiedSeats(tx, destination.id) },
          now,
        );
        assertAcademicRegistrationDestination(
          await academicGroupClosed(tx, destination.id),
          "destinationGroupId",
        );
        const [updated] = await tx
          .update(schema.preRegistrations)
          .set({
            groupId: destination.id,
            updatedAt: nextRegistrationVersion(row.updatedAt, now),
          })
          .where(eq(schema.preRegistrations.id, row.id))
          .returning();
        if (!updated)
          throw new RegistrationError("NOT_FOUND", "El registro no existe.");
        await registrationAudit(
          tx,
          actorId,
          row.id,
          "PRE_REGISTRATION_TRANSFERRED",
          { fromGroupId: row.groupId, toGroupId: destination.id },
        );
        return { result: await registrationDto(tx, updated, now) };
      },
    );
  }
  settings(actorId: string) {
    return this.read(actorId, (tx) => this.currentSettings(tx));
  }
  async updateSettings(raw: UpdateRegistrationSettingsInput, actorId: string) {
    const checked = validateSettings(raw);
    const input = {
      requestKey: validateRegistrationId(raw.requestKey, "requestKey"),
      revision: checked.revision,
      minimumPaymentPercent: checked.minimumPaymentPercent,
      auxiliaryDiscountPercent: checked.auxiliaryDiscountPercent,
    };
    return this.command(
      actorId,
      input.requestKey,
      "SETTINGS_UPDATE",
      input,
      async (tx, now) => {
        const previous = await this.currentSettings(tx);
        if (
          previous.revision !== input.revision ||
          previous.revision === 2147483647
        )
          throw new RegistrationError(
            "CONCURRENT_UPDATE",
            "Cambió la configuración. Recarga antes de guardar.",
          );
        const result = {
          revision: previous.revision + 1,
          minimumPaymentPercent: input.minimumPaymentPercent,
          auxiliaryDiscountPercent: input.auxiliaryDiscountPercent,
        };
        await tx
          .update(schema.registrationSettings)
          .set({ ...result, updatedBy: actorId, updatedAt: now })
          .where(eq(schema.registrationSettings.id, 1));
        await registrationAudit(
          tx,
          actorId,
          actorId,
          "REGISTRATION_SETTINGS_UPDATED",
          result,
          "REGISTRATION_SETTINGS",
        );
        return { result };
      },
    );
  }
  async detail(id: string, actorId: string) {
    validateRegistrationId(id, "registrationId");
    return this.read(actorId, async (tx, now) => {
      const [row] = await tx
        .select()
        .from(schema.preRegistrations)
        .where(eq(schema.preRegistrations.id, id));
      if (!row) return null;
      const ledger = await ledgerEntries(tx, id);
      return {
        registration: await registrationDto(tx, row, now, ledger),
        ledger,
      };
    });
  }
  async list(raw: RegistrationFilter, actorId: string) {
    const filter = validateRegistrationFilter(raw);
    return this.read(actorId, async (tx, now) => {
      const search = filter.search
        ? `%${filter.search.replace(/[\\%_]/gu, "\\$&")}%`
        : undefined;
      // State projection is computed in SQL before pagination, using the same authoritative clock.
      const totals = sql`(select coalesce(sum(case when kind = 'PAYMENT' then amount_cents else 0 end), 0) from registration_ledger l where l.registration_id = ${schema.preRegistrations.id})`;
      const refunded = sql`(select coalesce(sum(case when kind = 'REFUND' then amount_cents else 0 end), 0) from registration_ledger l where l.registration_id = ${schema.preRegistrations.id})`;
      const membership = sql`case when ${schema.preRegistrations.state} = 'CANCELLED' then 'CANCELADO' when ${now.toISOString()}::timestamptz < ${schema.courses.startsAt} then 'PREINSCRITO' when ${totals} = ${schema.preRegistrations.totalPriceCents} then 'INSCRITO' when ${now.toISOString()}::timestamptz < ((((${schema.courses.startsAt} at time zone 'America/La_Paz')::date + 1)::timestamp) at time zone 'America/La_Paz') then 'PREINSCRITO' else 'SALDOVENCIDO' end`;
      const financial = sql`case when ${schema.preRegistrations.state} = 'CANCELLED' then case when ${totals} > ${refunded} then 'REFUND_DUE' when ${totals} > 0 then 'REFUNDED' else 'EXEMPT' end when ${schema.preRegistrations.totalPriceCents} = 0 then 'EXEMPT' when ${totals} = ${schema.preRegistrations.totalPriceCents} then 'PAID' when ${totals} = 0 then 'UNPAID' else 'PARTIAL' end`;
      const where = and(
        filter.courseId
          ? eq(schema.preRegistrations.courseId, filter.courseId)
          : undefined,
        filter.groupId
          ? eq(schema.preRegistrations.groupId, filter.groupId)
          : undefined,
        filter.membershipStatus
          ? sql`${membership} = ${filter.membershipStatus}`
          : undefined,
        filter.financialStatus
          ? sql`${financial} = ${filter.financialStatus}`
          : undefined,
        search
          ? sql`(${schema.participants.ci} ilike ${search} or ${schema.participants.firstName} ilike ${search} or ${schema.participants.lastName} ilike ${search} or ${schema.participants.email} ilike ${search})`
          : undefined,
      );
      const base = () =>
        tx
          .select({
            pre_registrations: schema.preRegistrations,
            courses: schema.courses,
            participants: schema.participants,
            groups: schema.groups,
            registeredByName: schema.users.name,
          })
          .from(schema.preRegistrations)
          .innerJoin(
            schema.courses,
            eq(schema.courses.id, schema.preRegistrations.courseId),
          )
          .innerJoin(
            schema.participants,
            eq(schema.participants.id, schema.preRegistrations.participantId),
          )
          .innerJoin(
            schema.groups,
            eq(schema.groups.id, schema.preRegistrations.groupId),
          )
          .leftJoin(
            schema.users,
            eq(schema.users.id, schema.preRegistrations.createdBy),
          );
      const rows = await base()
        .where(where)
        .orderBy(
          asc(schema.preRegistrations.createdAt),
          asc(schema.preRegistrations.id),
        )
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize);
      const [count] = await tx
        .select({ total: sql<number>`count(*)::integer` })
        .from(schema.preRegistrations)
        .innerJoin(
          schema.courses,
          eq(schema.courses.id, schema.preRegistrations.courseId),
        )
        .innerJoin(
          schema.participants,
          eq(schema.participants.id, schema.preRegistrations.participantId),
        )
        .where(where);
      const pageLedger = rows.length
        ? await tx
            .select({
              entry: schema.registrationLedger,
              actorName: schema.users.name,
            })
            .from(schema.registrationLedger)
            .innerJoin(
              schema.users,
              eq(schema.users.id, schema.registrationLedger.actorId),
            )
            .where(
              inArray(
                schema.registrationLedger.registrationId,
                rows.map((row) => row.pre_registrations.id),
              ),
            )
            .orderBy(
              asc(schema.registrationLedger.recordedAt),
              asc(schema.registrationLedger.id),
            )
        : [];
      const ledgerByRegistration = new Map<string, LedgerEntryDto[]>();
      for (const { entry, actorName } of pageLedger) {
        const entries = ledgerByRegistration.get(entry.registrationId) ?? [];
        entries.push(ledgerDto(entry, actorName));
        ledgerByRegistration.set(entry.registrationId, entries);
      }
      return {
        items: await Promise.all(
          rows.map((row) =>
            registrationDto(
              tx,
              row.pre_registrations,
              now,
              ledgerByRegistration.get(row.pre_registrations.id) ?? [],
              {
                person: row.participants,
                registeredByName: row.registeredByName,
                course: row.courses,
                group: row.groups,
              },
            ),
          ),
        ),
        total: count?.total ?? 0,
        page: filter.page,
        pageSize: filter.pageSize,
      };
    });
  }
  async findParticipants(search: string, actorId: string, limit: number) {
    if (
      typeof search !== "string" ||
      search.trim().length < 2 ||
      search.length > 200 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw new RegistrationError(
        "VALIDATION_FAILED",
        "Busca con al menos dos caracteres; máximo 50 resultados.",
      );
    return this.read(actorId, async (tx) => {
      const pattern = `%${search.trim().replace(/[\\%_]/gu, "\\$&")}%`;
      return (
        await tx
          .select()
          .from(schema.participants)
          .where(
            sql`(${schema.participants.ci} ilike ${pattern} or ${schema.participants.firstName} ilike ${pattern} or ${schema.participants.lastName} ilike ${pattern} or ${schema.participants.email} ilike ${pattern})`,
          )
          .orderBy(
            asc(schema.participants.lastName),
            asc(schema.participants.firstName),
            asc(schema.participants.id),
          )
          .limit(limit)
      ).map(participantDto);
    });
  }
  async instructorRoster(
    courseId: string,
    groupId: string,
    instructorId: string,
  ) {
    validateRegistrationId(courseId, "courseId");
    validateRegistrationId(groupId, "groupId");
    return this.read(
      instructorId,
      async (tx, now) => {
        const [course] = await tx
          .select({ startsAt: schema.courses.startsAt })
          .from(schema.courses)
          .where(
            and(
              eq(schema.courses.id, courseId),
              eq(schema.courses.instructorId, instructorId),
            ),
          );
        const [group] = await tx
          .select({ id: schema.groups.id })
          .from(schema.groups)
          .where(
            and(
              eq(schema.groups.id, groupId),
              eq(schema.groups.courseId, courseId),
            ),
          );
        if (!course || !group || now < course.startsAt)
          throw new RegistrationError(
            "FORBIDDEN",
            "La lista solo está disponible para el instructor asignado desde el inicio oficial.",
          );
        return tx
          .select({
            firstName: schema.participants.firstName,
            lastName: schema.participants.lastName,
          })
          .from(schema.preRegistrations)
          .innerJoin(
            schema.participants,
            eq(schema.participants.id, schema.preRegistrations.participantId),
          )
          .where(
            and(
              eq(schema.preRegistrations.courseId, courseId),
              eq(schema.preRegistrations.groupId, groupId),
              eq(schema.preRegistrations.state, "ACTIVE"),
            ),
          )
          .orderBy(
            asc(schema.participants.lastName),
            asc(schema.participants.firstName),
            asc(schema.participants.id),
          );
      },
      "INSTRUCTOR",
    );
  }
}
export function createRegistrationRepository(
  db: RegistrationDatabase = getDatabase(),
  clock?: () => Date,
): RegistrationRepository {
  return new DrizzleRegistrationRepository(db, clock);
}
