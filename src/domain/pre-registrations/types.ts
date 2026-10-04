export const REGISTRATION_PARTICIPANT_TYPES = [
  "STUDENT",
  "EXTERNAL",
  "AUXILIARY",
] as const;
export type RegistrationParticipantType =
  (typeof REGISTRATION_PARTICIPANT_TYPES)[number];
export type RegistrationState = "ACTIVE" | "CANCELLED";
export type MembershipStatus =
  "PREINSCRITO" | "INSCRITO" | "SALDOVENCIDO" | "CANCELADO";
export type FinancialStatus =
  "EXEMPT" | "UNPAID" | "PARTIAL" | "PAID" | "REFUND_DUE" | "REFUNDED";
export type CancellationReason = "VOLUNTARY" | "GROUP_CANCELLED";
export type LedgerKind = "PAYMENT" | "REFUND";

export interface ParticipantData {
  readonly ci: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string | null;
}
export interface ParticipantDto extends ParticipantData {
  readonly id: string;
  readonly revision: string;
}
export interface RegistrationSettings {
  readonly minimumPaymentPercent: number;
  readonly auxiliaryDiscountPercent: number;
  readonly revision: number;
}
/** Integer cents only; bounded to the existing numeric(12,2) tariff range. */
export interface PriceSnapshot {
  readonly currency: "BOB";
  readonly courseTypeRevisionId: string;
  readonly settingsRevision: number;
  readonly participantType: RegistrationParticipantType;
  readonly basePriceCents: number;
  readonly discountPercent: number;
  readonly totalPriceCents: number;
  readonly minimumPaymentPercent: number;
  readonly minimumPaymentCents: number;
}
export interface LedgerEntryDto {
  readonly id: string;
  readonly kind: LedgerKind;
  readonly amountCents: number;
  readonly effectiveDate: string;
  readonly actorId: string;
  /** Current internal display name; present only in ADMIN finance responses. */
  readonly actorName?: string;
  readonly recordedAt: string;
  readonly reason: string | null;
}
export interface RegistrationFinance {
  readonly paidCents: number;
  readonly refundedCents: number;
  readonly balanceCents: number;
  readonly refundDueCents: number;
  readonly financialStatus: FinancialStatus;
}
export interface AdminRegistrationDto extends RegistrationFinance {
  readonly id: string;
  readonly courseId: string;
  readonly groupId: string;
  /** Current display labels, not part of the immutable financial snapshot. */
  readonly courseName?: string;
  readonly groupName?: string;
  /** Current actor name from the internal profile; ADMIN only. */
  readonly registeredByName?: string;
  readonly participant: ParticipantDto;
  readonly state: RegistrationState;
  readonly membershipStatus: MembershipStatus;
  readonly price: PriceSnapshot;
  readonly sourceInterestId: string | null;
  readonly firstDayException: boolean;
  readonly cancellationReason: CancellationReason | null;
  readonly cancelledAt: string | null;
  readonly revision: string;
  readonly createdAt: string;
  readonly paymentDeadlineExclusive: string;
}
/** Deliberately separate from administrative DTOs: no identity/contact/finance. */
export interface InstructorRosterEntryDto {
  readonly firstName: string;
  readonly lastName: string;
}
export interface RegistrationCourseContext {
  readonly id: string;
  readonly status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  readonly startsAt: Date;
  readonly registrationEndAt: Date | null;
  readonly instructorActive: boolean;
  readonly courseTypeRevisionId: string;
  readonly studentAmount: string;
  readonly externalAmount: string;
}
export interface RegistrationGroupContext {
  readonly id: string;
  readonly courseId: string;
  readonly courseTypeRevisionId: string;
  readonly status: "PLANNED" | "CANCELLED";
  readonly capacity: number;
  readonly occupied: number;
}
export interface RequestIdentity {
  readonly requestKey: string;
}
export interface CashInput {
  readonly amountCents: number;
  /** Null means today in Bolivia, resolved once by the transaction clock. */
  readonly effectiveDate: string | null;
  readonly reason?: string | null;
}
export interface CreateRegistrationInput extends RequestIdentity {
  readonly courseId: string;
  readonly groupId: string;
  readonly participant: ParticipantData;
  readonly participantType: RegistrationParticipantType;
  readonly sourceInterestId: string | null;
  readonly settingsRevision: number;
  readonly courseRevision: string;
  /** Explicit opt-in to the audited first-day exception, never inferred by UI. */
  readonly firstDayException: boolean;
  /** Free registrations have no cash entry, not a fabricated zero payment. */
  readonly initialPayment: CashInput | null;
}
export interface RegistrationMutationInput extends RequestIdentity {
  readonly registrationId: string;
  readonly revision: string;
}
export interface RecordCashInput extends RegistrationMutationInput {
  readonly cash: CashInput;
}
export interface CancelRegistrationInput extends RegistrationMutationInput {
  readonly reason: string;
  /** Actual cash returned now; null leaves an explicit refund liability. */
  readonly refundedNow: CashInput | null;
}
export interface TransferRegistrationInput extends RegistrationMutationInput {
  readonly destinationGroupId: string;
}
export interface UpdateParticipantInput extends RequestIdentity {
  readonly participantId: string;
  readonly revision: string;
  readonly participant: ParticipantData;
}
export interface UpdateRegistrationSettingsInput extends RequestIdentity {
  readonly revision: number;
  readonly minimumPaymentPercent: number;
  readonly auxiliaryDiscountPercent: number;
}
export interface RegistrationFilter {
  readonly courseId?: string;
  readonly groupId?: string;
  readonly membershipStatus?: MembershipStatus;
  readonly financialStatus?: FinancialStatus;
  readonly search?: string;
  readonly page: number;
  readonly pageSize: number;
}
export interface RegistrationPageDto {
  readonly items: readonly AdminRegistrationDto[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}
export interface RegistrationDetailDto {
  readonly registration: AdminRegistrationDto;
  readonly ledger: readonly LedgerEntryDto[];
}

export interface RegistrationFormDto {
  readonly course: {
    readonly id: string;
    readonly name: string;
    readonly revision: string;
    readonly status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    readonly startsAt: string;
    readonly registrationEndAt: string | null;
    readonly courseTypeRevisionId: string;
    readonly studentAmount: string;
    readonly externalAmount: string;
    readonly instructorActive: boolean;
  };
  readonly groups: readonly {
    readonly id: string;
    readonly groupName?: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly capacity: number;
    readonly occupied: number;
    readonly status: "PLANNED" | "CANCELLED";
  }[];
  readonly settings: RegistrationSettings;
  /** Server-fetched same-course origin, never inferred by participant email. */
  readonly sourceInterest: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string;
    readonly phone: string | null;
  } | null;
}
