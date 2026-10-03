import { RegistrationError } from "./errors";
import { assertCents } from "./money";
import type {
  LedgerKind,
  PriceSnapshot,
  RegistrationFinance,
  RegistrationState,
} from "./types";

export function registrationFinance(
  price: PriceSnapshot,
  state: RegistrationState,
  entries: readonly { kind: LedgerKind; amountCents: number }[],
): RegistrationFinance {
  assertCents(price.totalPriceCents);
  let paid = 0n;
  let refunded = 0n;
  for (const entry of entries) {
    assertCents(entry.amountCents, "amountCents", true);
    if (entry.kind === "PAYMENT") paid += BigInt(entry.amountCents);
    else if (entry.kind === "REFUND") refunded += BigInt(entry.amountCents);
    else
      throw new RegistrationError(
        "VALIDATION_FAILED",
        "El tipo de movimiento no es válido.",
      );
  }
  if (paid > BigInt(price.totalPriceCents))
    throw new RegistrationError(
      "PAYMENT_EXCEEDS_BALANCE",
      "Los pagos superan el precio aplicado.",
    );
  if (refunded > paid)
    throw new RegistrationError(
      "REFUND_EXCEEDS_DUE",
      "Las devoluciones superan lo pagado.",
    );
  if (state === "ACTIVE" && refunded > 0n)
    throw new RegistrationError(
      "REFUND_REQUIRES_CANCELLATION",
      "Cancela el registro antes de registrar una devolución.",
    );
  const paidCents = Number(paid);
  const refundedCents = Number(refunded);
  const balanceCents =
    state === "CANCELLED" ? 0 : price.totalPriceCents - paidCents;
  const refundDueCents = state === "CANCELLED" ? paidCents - refundedCents : 0;
  const financialStatus =
    state === "CANCELLED"
      ? refundDueCents > 0
        ? "REFUND_DUE"
        : paidCents > 0
          ? "REFUNDED"
          : "EXEMPT"
      : price.totalPriceCents === 0
        ? "EXEMPT"
        : balanceCents === 0
          ? "PAID"
          : paidCents === 0
            ? "UNPAID"
            : "PARTIAL";
  return {
    paidCents,
    refundedCents,
    balanceCents,
    refundDueCents,
    financialStatus,
  };
}
export function assertRefund(
  state: RegistrationState,
  finance: RegistrationFinance,
  amountCents: number,
): void {
  assertCents(amountCents, "amountCents", true);
  if (state !== "CANCELLED")
    throw new RegistrationError(
      "REFUND_REQUIRES_CANCELLATION",
      "Cancela el registro antes de registrar una devolución.",
    );
  if (amountCents > finance.refundDueCents)
    throw new RegistrationError(
      "REFUND_EXCEEDS_DUE",
      "El monto supera la devolución pendiente.",
      { amountCents: "No puede superar el monto pendiente de devolución." },
      { maximumCents: finance.refundDueCents },
    );
}
