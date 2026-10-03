export type RegistrationErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONCURRENT_UPDATE"
  | "CI_ALREADY_EXISTS"
  | "PARTICIPANT_DETAILS_CONFLICT"
  | "ACTIVE_REGISTRATION_EXISTS"
  | "IDEMPOTENCY_CONFLICT"
  | "COURSE_UNAVAILABLE"
  | "INSTRUCTOR_INACTIVE"
  | "GROUP_UNAVAILABLE"
  | "GROUP_COURSE_MISMATCH"
  | "CAPACITY_EXCEEDED"
  | "REGISTRATION_CLOSED"
  | "FIRST_DAY_EXCEPTION_UNAVAILABLE"
  | "FULL_PAYMENT_REQUIRED"
  | "INITIAL_PAYMENT_REQUIRED"
  | "MINIMUM_PAYMENT_REQUIRED"
  | "PAYMENT_EXCEEDS_BALANCE"
  | "PAYMENT_DEADLINE_PASSED"
  | "REGISTRATION_CANCELLED"
  | "REFUND_REQUIRES_CANCELLATION"
  | "REFUND_EXCEEDS_DUE"
  | "CANCELLATION_CLOSED"
  | "TRANSFER_CLOSED";
export class RegistrationError extends Error {
  constructor(
    public readonly code: RegistrationErrorCode,
    message: string,
    public readonly issues: Readonly<Record<string, string>> = {},
    public readonly details: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "RegistrationError";
  }
}
