import { and, asc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import { registrationFinance } from "@/domain/pre-registrations/finance";
import { firstDayDeadlineExclusive } from "@/domain/pre-registrations/time";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import { membershipStatus } from "@/domain/pre-registrations/policies";
import type {
  AdminRegistrationDto,
  LedgerEntryDto,
  ParticipantDto,
  PriceSnapshot,
  RegistrationCourseContext,
} from "@/domain/pre-registrations/types";

export type RegistrationDatabase = PostgresJsDatabase<typeof schema>;
export type RegistrationTransaction = Parameters<
  Parameters<RegistrationDatabase["transaction"]>[0]
>[0];
export type RegistrationRow = typeof schema.preRegistrations.$inferSelect;
export type ParticipantRow = typeof schema.participants.$inferSelect;
type LedgerRow = typeof schema.registrationLedger.$inferSelect;
interface RegistrationDisplay {
  readonly person: ParticipantRow;
  readonly course: Pick<
    typeof schema.courses.$inferSelect,
    "name" | "startsAt"
  >;
  readonly group: Pick<
    typeof schema.groups.$inferSelect,
    "startsAt" | "endsAt"
  >;
}
export function registrationGroupName(
  group: RegistrationDisplay["group"],
): string {
  return `${instantToBoliviaCivil(group.startsAt).slice(11)}–${instantToBoliviaCivil(group.endsAt).slice(11)}`;
}
export function ledgerDto(row: LedgerRow): LedgerEntryDto {
  return {
    id: row.id,
    kind: row.kind,
    amountCents: Number(row.amountCents),
    effectiveDate: row.effectiveDate,
    actorId: row.actorId,
    reason: row.reason,
    recordedAt: row.recordedAt.toISOString(),
  };
}
export const nextRegistrationVersion = (previous: Date, now: Date) =>
  new Date(Math.max(now.getTime(), previous.getTime() + 1));
export function assertFreshRevision(actual: Date, expected: string): void {
  if (actual.toISOString() !== expected)
    throw new RegistrationError(
      "CONCURRENT_UPDATE",
      "El registro cambió. Recarga y revisa los datos antes de reintentar.",
    );
}
export async function requireFreshRegistrationActor(
  tx: RegistrationTransaction,
  actorId: string,
  role: "ADMIN" | "INSTRUCTOR" = "ADMIN",
) {
  // A row-share lock makes revocation wait until this authorized operation completes.
  const [actor] = await tx
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, actorId))
    .for("share");
  const [permission] = await tx
    .select()
    .from(schema.userRoles)
    .where(
      and(
        eq(schema.userRoles.userId, actorId),
        eq(schema.userRoles.roleCode, role),
      ),
    )
    .for("share");
  if (!actor || actor.status !== "ACTIVE" || !permission)
    throw new RegistrationError(
      "FORBIDDEN",
      "La cuenta no tiene autorización vigente.",
    );
}
export function participantDto(row: ParticipantRow): ParticipantDto {
  return {
    id: row.id,
    ci: row.ci,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    revision: row.updatedAt.toISOString(),
  };
}
export function priceDto(row: RegistrationRow): PriceSnapshot {
  return {
    currency: "BOB",
    courseTypeRevisionId: row.courseTypeRevisionId,
    settingsRevision: row.settingsRevision,
    participantType: row.participantType,
    basePriceCents: Number(row.basePriceCents),
    discountPercent: row.discountPercent,
    totalPriceCents: Number(row.totalPriceCents),
    minimumPaymentPercent: row.minimumPaymentPercent,
    minimumPaymentCents: Number(row.minimumPaymentCents),
  };
}
export async function courseContext(
  tx: RegistrationTransaction,
  id: string,
  lock = false,
) {
  const query = tx
    .select()
    .from(schema.courses)
    .where(eq(schema.courses.id, id));
  const [course] = await (lock ? query.for("update") : query);
  if (!course) throw new RegistrationError("NOT_FOUND", "El curso no existe.");
  const [tariff] = await tx
    .select()
    .from(schema.courseTypeRevisions)
    .where(eq(schema.courseTypeRevisions.id, course.courseTypeRevisionId));
  if (!tariff)
    throw new RegistrationError(
      "COURSE_UNAVAILABLE",
      "El formato no está disponible.",
    );
  const [instructor] = course.instructorId
    ? await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .innerJoin(
          schema.userRoles,
          and(
            eq(schema.userRoles.userId, schema.users.id),
            eq(schema.userRoles.roleCode, "INSTRUCTOR"),
          ),
        )
        .where(
          and(
            eq(schema.users.id, course.instructorId),
            eq(schema.users.status, "ACTIVE"),
          ),
        )
        .for("share")
    : [];
  const context: RegistrationCourseContext = {
    id: course.id,
    status: course.status,
    startsAt: course.startsAt,
    registrationEndAt: course.registrationEndAt,
    instructorActive: Boolean(instructor),
    courseTypeRevisionId: tariff.id,
    studentAmount: tariff.studentAmount,
    externalAmount: tariff.externalAmount,
  };
  return { course, context };
}
export async function ledgerEntries(
  tx: RegistrationTransaction,
  id: string,
): Promise<LedgerEntryDto[]> {
  return (
    await tx
      .select()
      .from(schema.registrationLedger)
      .where(eq(schema.registrationLedger.registrationId, id))
      .orderBy(
        asc(schema.registrationLedger.recordedAt),
        asc(schema.registrationLedger.id),
      )
  ).map(ledgerDto);
}
export async function registrationDto(
  tx: RegistrationTransaction,
  row: RegistrationRow,
  now: Date,
  entries?: readonly LedgerEntryDto[],
  display?: RegistrationDisplay,
): Promise<AdminRegistrationDto> {
  const resolved =
    display ??
    (
      await tx
        .select({
          person: schema.participants,
          course: {
            name: schema.courses.name,
            startsAt: schema.courses.startsAt,
          },
          group: {
            startsAt: schema.groups.startsAt,
            endsAt: schema.groups.endsAt,
          },
        })
        .from(schema.preRegistrations)
        .innerJoin(
          schema.participants,
          eq(schema.participants.id, schema.preRegistrations.participantId),
        )
        .innerJoin(
          schema.courses,
          eq(schema.courses.id, schema.preRegistrations.courseId),
        )
        .innerJoin(
          schema.groups,
          eq(schema.groups.id, schema.preRegistrations.groupId),
        )
        .where(eq(schema.preRegistrations.id, row.id))
    )[0];
  if (!resolved)
    throw new RegistrationError("NOT_FOUND", "El registro no está disponible.");
  const { person, course, group } = resolved;
  const price = priceDto(row);
  const finance = registrationFinance(
    price,
    row.state,
    entries ?? (await ledgerEntries(tx, row.id)),
  );
  return {
    id: row.id,
    courseId: row.courseId,
    groupId: row.groupId,
    courseName: course.name,
    groupName: registrationGroupName(group),
    participant: participantDto(person),
    state: row.state,
    membershipStatus: membershipStatus(
      row.state,
      finance.balanceCents,
      course.startsAt,
      now,
    ),
    price,
    ...finance,
    sourceInterestId: row.sourceInterestId,
    firstDayException: row.firstDayException,
    cancellationReason: row.cancellationReason,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    revision: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    paymentDeadlineExclusive: firstDayDeadlineExclusive(
      course.startsAt,
    ).toISOString(),
  };
}
export async function occupiedSeats(
  tx: RegistrationTransaction,
  groupId: string,
) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::integer` })
    .from(schema.preRegistrations)
    .where(
      and(
        eq(schema.preRegistrations.groupId, groupId),
        eq(schema.preRegistrations.state, "ACTIVE"),
      ),
    );
  return row?.count ?? 0;
}
export async function registrationAudit(
  tx: RegistrationTransaction,
  actorId: string,
  id: string,
  action: string,
  metadata: Record<string, string | number | boolean | null> = {},
  entityType = "PRE_REGISTRATION",
) {
  await tx
    .insert(schema.auditEvents)
    .values({ actorId, entityId: id, entityType, action, metadata });
}
