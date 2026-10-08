import type {
  ClosureBlocker,
  ClosureCommand,
  ClosureReportDto,
  ReopenGroupInput,
} from "./types";

export class ClosureError extends Error {
  constructor(
    public readonly code:
      | "VALIDATION_FAILED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONCURRENT_UPDATE"
      | "IDEMPOTENCY_CONFLICT"
      | "GROUP_CLOSED"
      | "GROUP_OPEN"
      | "CLOSURE_BLOCKED",
    message: string,
    public readonly issues: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "ClosureError";
  }
}
export function closureId(value: string, field: string): void {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    throw new ClosureError("VALIDATION_FAILED", "Identificador no válido.", {
      [field]: "Usa un UUID válido.",
    });
}
export function validateClosureCommand(input: ClosureCommand): void {
  for (const field of ["courseId", "groupId", "requestKey"] as const)
    closureId(input[field], field);
  if (!Number.isSafeInteger(input.revision) || input.revision < 0)
    throw new ClosureError("VALIDATION_FAILED", "Revisión no válida.", {
      revision: "Recarga la revisión vigente.",
    });
}
export function validateReopen(input: ReopenGroupInput): void {
  validateClosureCommand(input);
  if (
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.trim().length > 500 ||
    /[\p{Cc}]/u.test(input.reason)
  )
    throw new ClosureError(
      "VALIDATION_FAILED",
      "Indica el motivo de reapertura.",
      { reason: "Introduce un motivo de 1 a 500 caracteres." },
    );
}
/** Uses the existing attendance projection: yesterday's inferred absence is resolved,
 * today's missing evidence is pending. No hidden marks or automatic grade zeroes. */
export function closureBlockers(
  report: ClosureReportDto,
  now: Date,
): ClosureBlocker[] {
  const active = report.sessions.filter(
    (session) => session.cancelledAt === null,
  );
  const blockers: ClosureBlocker[] = [];
  if (active.some((session) => new Date(session.endsAt) > now))
    blockers.push("SESSIONS_UNFINISHED");
  if (report.participants.some((person) => person.result.status !== "COMPLETE"))
    blockers.push("GRADES_PENDING");
  if (
    active.some(
      (session) =>
        session.administrativeReviewRequired ||
        (report.instructorId !== null &&
          session.instructorAttendance.status === "PENDING") ||
        session.participants.some(
          (person) => person.attendance.status === "PENDING",
        ),
    )
  )
    blockers.push("ATTENDANCE_PENDING");
  return blockers;
}
