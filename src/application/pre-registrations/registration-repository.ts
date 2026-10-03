import type {
  AdminRegistrationDto,
  CancelRegistrationInput,
  CreateRegistrationInput,
  InstructorRosterEntryDto,
  ParticipantDto,
  RecordCashInput,
  RegistrationDetailDto,
  RegistrationFormDto,
  RegistrationFilter,
  RegistrationPageDto,
  RegistrationSettings,
  TransferRegistrationInput,
  UpdateParticipantInput,
  UpdateRegistrationSettingsInput,
  RequestIdentity,
} from "@/domain/pre-registrations/types";

/**
 * Server-only persistence contract. Application services must require an active
 * ADMIN before calling administrative methods; adapters recheck that actor's
 * current status/role transactionally. No HTTP or client authorization here.
 *
 * Each command is one atomic transaction including receipt, audit, identity,
 * membership and actual cash entries. Request keys are actor-scoped UUIDs across
 * ALL commands. Persist a server-produced SHA-256 fingerprint of the canonical
 * command/payload (including explicit source ID, excluding clock/default today).
 * Same actor/key/fingerprint returns the original receipt; mismatches fail with
 * IDEMPOTENCY_CONFLICT. Resolve clock/default date once, never on retry.
 *
 * Reuse lockInstructorSchedules from the existing instructor-schedule
 * adapter FIRST (do not invent a second gate). Then lock COURSE -> GROUP IDs in
 * lexical order -> participant/registration -> ledger. CI creation/reuse must
 * serialize on normalized CI (unique insert/upsert then row lock), never email.
 * create() reuses matching CI without silently overwriting the global profile;
 * conflicting supplied profile fields require explicit authorized updateParticipant
 * (PARTICIPANT_DETAILS_CONFLICT). Public interest is editable prefill, not identity.
 * Group cancellation/capacity edits MUST use the same gate/course/group locks.
 * Check destination capacity by ACTIVE rows while locked; SALDOVENCIDO occupies
 * a seat, CANCELLED immediately releases it. Validate all current states,
 * revisions, settings and tariff under locks, not against earlier UI reads.
 *
 * No implementation is supplied in the foundation: persistence owns these
 * checks and application authorization, and must prove last-seat races in DB.
 */
export interface RegistrationRepository {
  form(
    courseId: string,
    actorId: string,
    sourceInterestId?: string,
  ): Promise<RegistrationFormDto | null>;
  create(
    input: CreateRegistrationInput,
    actorId: string,
  ): Promise<AdminRegistrationDto>;
  updateParticipant(
    input: UpdateParticipantInput,
    actorId: string,
  ): Promise<ParticipantDto>;
  recordPayment(
    input: RecordCashInput,
    actorId: string,
  ): Promise<RegistrationDetailDto>;
  recordRefund(
    input: RecordCashInput,
    actorId: string,
  ): Promise<RegistrationDetailDto>;
  cancel(
    input: CancelRegistrationInput,
    actorId: string,
  ): Promise<RegistrationDetailDto>;
  transfer(
    input: TransferRegistrationInput,
    actorId: string,
  ): Promise<AdminRegistrationDto>;
  settings(actorId: string): Promise<RegistrationSettings>;
  updateSettings(
    input: UpdateRegistrationSettingsInput,
    actorId: string,
  ): Promise<RegistrationSettings>;
  list(
    filter: RegistrationFilter,
    actorId: string,
  ): Promise<RegistrationPageDto>;
  detail(
    registrationId: string,
    actorId: string,
  ): Promise<RegistrationDetailDto | null>;
  findParticipants(
    search: string,
    actorId: string,
    limit: number,
  ): Promise<readonly ParticipantDto[]>;
  /** Ownership and start guard in server query; ACTIVE names only, no exports. */
  instructorRoster(
    courseId: string,
    groupId: string,
    instructorId: string,
  ): Promise<readonly InstructorRosterEntryDto[]>;
}

export interface CancelRegisteredGroupInput extends RequestIdentity {
  readonly courseId: string;
  readonly groupId: string;
  readonly revision: string;
  readonly reason: string;
}
/**
 * Hook contract for the existing group cancellation transaction, not a parallel
 * group command. Cancel ACTIVE memberships, preserve snapshots/ledger, audit
 * each cancellation and create refund liability = paid - refunded. Never post
 * fictional bulk REFUND entries. Existing last-active-group guard still applies.
 */
export interface RegisteredGroupCancellationResult {
  readonly cancelledRegistrationIds: readonly string[];
  readonly refundDueCents: number;
}

/** CSV/PDF consumer pages through authorized list(); no public/export roster port. */
export interface RegistrationExportPort {
  render(
    format: "CSV" | "PDF",
    rows: readonly AdminRegistrationDto[],
  ): Promise<Uint8Array>;
}
