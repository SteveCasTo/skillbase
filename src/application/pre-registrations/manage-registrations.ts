import type { InternalUser } from "@/domain/auth/types";
import type {
  RegistrationFilter,
  RegistrationMutationInput,
  UpdateParticipantInput,
  RecordCashInput,
  CancelRegistrationInput,
  TransferRegistrationInput,
  UpdateRegistrationSettingsInput,
} from "@/domain/pre-registrations/types";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import { validateParticipant } from "@/domain/pre-registrations/participant";
import { validateSettings } from "@/domain/pre-registrations/money";
import {
  validateCashInput,
  validateCreateRegistration,
  validateRegistrationId,
  validateRegistrationRevision,
} from "@/domain/pre-registrations/validation";
import { requireRegistrationAdmin } from "./authorization";
import type { RegistrationRepository } from "./registration-repository";

export function validateMutation<T extends RegistrationMutationInput>(
  input: T,
): T {
  return {
    ...input,
    requestKey: validateRegistrationId(input.requestKey, "requestKey"),
    registrationId: validateRegistrationId(
      input.registrationId,
      "registrationId",
    ),
    revision: validateRegistrationRevision(input.revision),
  };
}
export function validateRegistrationReason(reason: string): string {
  if (
    typeof reason !== "string" ||
    !reason.trim() ||
    [...reason.trim()].length > 500 ||
    /\p{Cc}/u.test(reason)
  )
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Introduce un motivo válido.",
      { reason: "Introduce un motivo de hasta 500 caracteres." },
    );
  return reason.trim();
}
export function validateRegistrationFilter(
  filter: RegistrationFilter,
): RegistrationFilter {
  if (
    !Number.isInteger(filter.page) ||
    filter.page < 1 ||
    filter.page > 1000 ||
    !Number.isInteger(filter.pageSize) ||
    filter.pageSize < 1 ||
    filter.pageSize > 100 ||
    (filter.search !== undefined &&
      (typeof filter.search !== "string" || filter.search.length > 200)) ||
    (filter.membershipStatus !== undefined &&
      !["PREINSCRITO", "INSCRITO", "SALDOVENCIDO", "CANCELADO"].includes(
        filter.membershipStatus,
      )) ||
    (filter.financialStatus !== undefined &&
      ![
        "EXEMPT",
        "UNPAID",
        "PARTIAL",
        "PAID",
        "REFUND_DUE",
        "REFUNDED",
      ].includes(filter.financialStatus))
  )
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Los filtros no son válidos.",
    );
  return {
    ...filter,
    ...(filter.courseId
      ? { courseId: validateRegistrationId(filter.courseId, "courseId") }
      : {}),
    ...(filter.groupId
      ? { groupId: validateRegistrationId(filter.groupId, "groupId") }
      : {}),
    ...(filter.search === undefined ? {} : { search: filter.search.trim() }),
  };
}
export async function getRegistrationForm(
  repository: RegistrationRepository,
  actor: InternalUser | null,
  courseId: string,
  sourceInterestId?: string,
) {
  requireRegistrationAdmin(actor);
  return repository.form(
    validateRegistrationId(courseId, "courseId"),
    actor.id,
    sourceInterestId === undefined
      ? undefined
      : validateRegistrationId(sourceInterestId, "sourceInterestId"),
  );
}
export async function createRegistration(
  repository: RegistrationRepository,
  actor: InternalUser | null,
  raw: unknown,
  now = new Date(),
) {
  requireRegistrationAdmin(actor);
  return repository.create(validateCreateRegistration(raw, now), actor.id);
}
export async function updateParticipant(
  repository: RegistrationRepository,
  actor: InternalUser | null,
  input: UpdateParticipantInput,
) {
  requireRegistrationAdmin(actor);
  return repository.updateParticipant(
    {
      requestKey: validateRegistrationId(input.requestKey, "requestKey"),
      participantId: validateRegistrationId(
        input.participantId,
        "participantId",
      ),
      revision: validateRegistrationRevision(input.revision),
      participant: validateParticipant(input.participant),
    },
    actor.id,
  );
}
export async function recordRegistrationPayment(
  repository: RegistrationRepository,
  actor: InternalUser | null,
  input: RecordCashInput,
  now = new Date(),
) {
  requireRegistrationAdmin(actor);
  return repository.recordPayment(
    {
      ...validateMutation(input),
      cash: validateCashInput(input.cash, now, false),
    },
    actor.id,
  );
}
export async function recordRegistrationRefund(
  repository: RegistrationRepository,
  actor: InternalUser | null,
  input: RecordCashInput,
  now = new Date(),
) {
  requireRegistrationAdmin(actor);
  return repository.recordRefund(
    { ...validateMutation(input), cash: validateCashInput(input.cash, now) },
    actor.id,
  );
}
export async function cancelRegistration(
  repository: RegistrationRepository,
  actor: InternalUser | null,
  input: CancelRegistrationInput,
  now = new Date(),
) {
  requireRegistrationAdmin(actor);
  return repository.cancel(
    {
      ...validateMutation(input),
      reason: validateRegistrationReason(input.reason),
      refundedNow:
        input.refundedNow === null
          ? null
          : validateCashInput(input.refundedNow, now),
    },
    actor.id,
  );
}
export async function transferRegistration(
  repository: RegistrationRepository,
  actor: InternalUser | null,
  input: TransferRegistrationInput,
) {
  requireRegistrationAdmin(actor);
  return repository.transfer(
    {
      ...validateMutation(input),
      destinationGroupId: validateRegistrationId(
        input.destinationGroupId,
        "destinationGroupId",
      ),
    },
    actor.id,
  );
}
export async function getRegistrationSettings(
  repository: RegistrationRepository,
  actor: InternalUser | null,
) {
  requireRegistrationAdmin(actor);
  return repository.settings(actor.id);
}
export async function updateRegistrationSettings(
  repository: RegistrationRepository,
  actor: InternalUser | null,
  input: UpdateRegistrationSettingsInput,
) {
  requireRegistrationAdmin(actor);
  const settings = validateSettings(input);
  return repository.updateSettings(
    {
      requestKey: validateRegistrationId(input.requestKey, "requestKey"),
      revision: settings.revision,
      minimumPaymentPercent: settings.minimumPaymentPercent,
      auxiliaryDiscountPercent: settings.auxiliaryDiscountPercent,
    },
    actor.id,
  );
}
export async function listRegistrations(
  repository: RegistrationRepository,
  actor: InternalUser | null,
  filter: RegistrationFilter,
) {
  requireRegistrationAdmin(actor);
  return repository.list(validateRegistrationFilter(filter), actor.id);
}
export async function getRegistrationDetail(
  repository: RegistrationRepository,
  actor: InternalUser | null,
  id: string,
) {
  requireRegistrationAdmin(actor);
  return repository.detail(
    validateRegistrationId(id, "registrationId"),
    actor.id,
  );
}
export async function findParticipants(
  repository: RegistrationRepository,
  actor: InternalUser | null,
  search: string,
  limit = 20,
) {
  requireRegistrationAdmin(actor);
  return repository.findParticipants(search, actor.id, limit);
}
export async function getInstructorRoster(
  repository: RegistrationRepository,
  actor: InternalUser | null,
  courseId: string,
  groupId: string,
) {
  if (
    !actor ||
    actor.status !== "ACTIVE" ||
    !actor.roles.includes("INSTRUCTOR")
  )
    throw new RegistrationError("FORBIDDEN", "Acceso no autorizado.");
  return repository.instructorRoster(
    validateRegistrationId(courseId, "courseId"),
    validateRegistrationId(groupId, "groupId"),
    actor.id,
  );
}
