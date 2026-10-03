import { RegistrationError } from "./errors";
import { assertCents } from "./money";
import { boliviaToday, firstDayDeadlineExclusive } from "./time";
import type {
  CancellationReason,
  MembershipStatus,
  PriceSnapshot,
  RegistrationCourseContext,
  RegistrationFinance,
  RegistrationGroupContext,
  RegistrationState,
} from "./types";

export function normalRegistrationOpen(
  course: Pick<
    RegistrationCourseContext,
    "status" | "startsAt" | "registrationEndAt"
  >,
  now: Date,
): boolean {
  // Publication opens registration; existing precise closing instants remain exclusive.
  return (
    course.status === "PUBLISHED" &&
    now < (course.registrationEndAt ?? course.startsAt)
  );
}
export function assertEligibleDestination(
  course: RegistrationCourseContext,
  group: RegistrationGroupContext,
): void {
  if (
    !Number.isInteger(group.capacity) ||
    group.capacity < 1 ||
    !Number.isInteger(group.occupied) ||
    group.occupied < 0
  )
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "El cupo del grupo no es válido.",
    );
  if (course.status !== "PUBLISHED")
    throw new RegistrationError(
      "COURSE_UNAVAILABLE",
      "Selecciona un curso publicado.",
      { courseId: "El curso no está publicado." },
    );
  if (!course.instructorActive)
    throw new RegistrationError(
      "INSTRUCTOR_INACTIVE",
      "Asigna un instructor activo al curso.",
    );
  if (
    group.courseId !== course.id ||
    group.courseTypeRevisionId !== course.courseTypeRevisionId
  )
    throw new RegistrationError(
      "GROUP_COURSE_MISMATCH",
      "Selecciona un grupo del mismo curso y formato.",
      { groupId: "El grupo no corresponde al curso." },
    );
  if (group.status !== "PLANNED")
    throw new RegistrationError(
      "GROUP_UNAVAILABLE",
      "Selecciona un grupo activo.",
      { groupId: "El grupo está cancelado." },
    );
  if (group.occupied >= group.capacity)
    throw new RegistrationError(
      "CAPACITY_EXCEEDED",
      "El grupo no tiene cupo disponible.",
      { groupId: "Selecciona otro grupo con cupo." },
    );
}
export function assertRegistrationPayment(
  course: RegistrationCourseContext,
  price: PriceSnapshot,
  paymentCents: number | null,
  exception: boolean,
  now: Date,
): void {
  if (exception) {
    if (
      normalRegistrationOpen(course, now) ||
      boliviaToday(now) !== boliviaToday(course.startsAt)
    )
      throw new RegistrationError(
        "FIRST_DAY_EXCEPTION_UNAVAILABLE",
        "La excepción solo está disponible el primer día cuando cerró el registro ordinario.",
      );
  } else if (!normalRegistrationOpen(course, now))
    throw new RegistrationError(
      "REGISTRATION_CLOSED",
      "El registro ordinario está cerrado.",
    );
  if (price.totalPriceCents === 0) {
    if (paymentCents !== null)
      throw new RegistrationError(
        "VALIDATION_FAILED",
        "Un registro gratuito no requiere movimiento de efectivo.",
        { initialPayment: "Continúa sin registrar un pago." },
      );
    return;
  }
  if (paymentCents === null)
    throw new RegistrationError(
      "INITIAL_PAYMENT_REQUIRED",
      "Registra el primer pago en efectivo.",
    );
  assertCents(paymentCents, "amountCents", true);
  if (paymentCents > price.totalPriceCents)
    throw new RegistrationError(
      "PAYMENT_EXCEEDS_BALANCE",
      "El pago supera el precio aplicado.",
      { amountCents: "No puede superar el total." },
      { maximumCents: price.totalPriceCents },
    );
  if (exception && paymentCents !== price.totalPriceCents)
    throw new RegistrationError(
      "FULL_PAYMENT_REQUIRED",
      "La excepción de primer día requiere pago total.",
      { amountCents: "Registra el total completo." },
      { minimumCents: price.totalPriceCents },
    );
  if (paymentCents < price.minimumPaymentCents)
    throw new RegistrationError(
      "MINIMUM_PAYMENT_REQUIRED",
      "El primer pago no alcanza el mínimo.",
      { amountCents: "Registra al menos el mínimo indicado." },
      { minimumCents: price.minimumPaymentCents },
    );
}
export function membershipStatus(
  state: RegistrationState,
  balanceCents: number,
  startsAt: Date,
  now: Date,
): MembershipStatus {
  assertCents(balanceCents, "balanceCents");
  if (state === "CANCELLED") return "CANCELADO";
  if (now < startsAt) return "PREINSCRITO";
  if (balanceCents === 0) return "INSCRITO";
  return now < firstDayDeadlineExclusive(startsAt)
    ? "PREINSCRITO"
    : "SALDOVENCIDO";
}
export function assertAdditionalPayment(
  state: RegistrationState,
  finance: RegistrationFinance,
  amountCents: number,
  startsAt: Date,
  now: Date,
): void {
  if (state === "CANCELLED")
    throw new RegistrationError(
      "REGISTRATION_CANCELLED",
      "El registro está cancelado.",
    );
  const deadline = firstDayDeadlineExclusive(startsAt);
  if (now >= deadline)
    throw new RegistrationError(
      "PAYMENT_DEADLINE_PASSED",
      "Terminó el plazo de regularización del primer día. No se admiten abonos ordinarios.",
      {},
      { paymentDeadlineExclusive: deadline.toISOString() },
    );
  assertCents(amountCents, "amountCents", true);
  if (amountCents > finance.balanceCents)
    throw new RegistrationError(
      "PAYMENT_EXCEEDS_BALANCE",
      "El abono supera el saldo pendiente.",
      { amountCents: "No puede superar el saldo pendiente." },
      { maximumCents: finance.balanceCents },
    );
}
export function assertCancellation(
  course: RegistrationCourseContext,
  state: RegistrationState,
  reason: CancellationReason,
  now: Date,
): void {
  if (state === "CANCELLED")
    throw new RegistrationError(
      "REGISTRATION_CANCELLED",
      "El registro ya está cancelado.",
    );
  if (
    reason === "VOLUNTARY" &&
    now >= (course.registrationEndAt ?? course.startsAt)
  )
    throw new RegistrationError(
      "CANCELLATION_CLOSED",
      "Terminó el plazo de cancelación voluntaria.",
    );
}
export function assertTransfer(
  course: RegistrationCourseContext,
  state: RegistrationState,
  destination: RegistrationGroupContext,
  now: Date,
): void {
  if (state === "CANCELLED")
    throw new RegistrationError(
      "REGISTRATION_CANCELLED",
      "El registro está cancelado.",
    );
  if (!normalRegistrationOpen(course, now))
    throw new RegistrationError(
      "TRANSFER_CLOSED",
      "Terminó el plazo de cambio de grupo.",
    );
  assertEligibleDestination(course, destination);
}
