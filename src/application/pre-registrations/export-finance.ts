import { RegistrationError } from "@/domain/pre-registrations/errors";
import { assertCents } from "@/domain/pre-registrations/money";
import type {
  AdminRegistrationDto,
  LedgerEntryDto,
  RegistrationFilter,
} from "@/domain/pre-registrations/types";

export interface RegistrationExportRow extends AdminRegistrationDto {
  readonly cashNetCents: number;
  readonly qrNetCents: number;
  readonly unrecordedMethodNetCents: number;
  readonly receivedNetCents: number;
}
export interface RegistrationExportPage {
  readonly items: readonly RegistrationExportRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}
export interface RegistrationExportRepository {
  list(
    filter: RegistrationFilter,
    actorId: string,
  ): Promise<RegistrationExportPage>;
}
export interface RegistrationExportContext {
  readonly generatedAt: Date;
  readonly filter: RegistrationFilter;
}

/** Live ledger projection, not an academic closure snapshot. Refunds are
 * subtracted from their recorded method; a method bucket may be negative. */
export function registrationExportFinance(
  row: AdminRegistrationDto,
  ledger: readonly LedgerEntryDto[],
): RegistrationExportRow {
  let cash = 0n;
  let qr = 0n;
  let unrecorded = 0n;
  for (const entry of ledger) {
    assertCents(entry.amountCents);
    const amount =
      BigInt(entry.amountCents) * (entry.kind === "REFUND" ? -1n : 1n);
    if (entry.paymentMethod === "CASH") cash += amount;
    else if (entry.paymentMethod === "QR") qr += amount;
    else unrecorded += amount;
  }
  const received = cash + qr + unrecorded;
  if (
    received !== BigInt(row.paidCents) - BigInt(row.refundedCents) ||
    [cash, qr, unrecorded, received].some(
      (amount) => !Number.isSafeInteger(Number(amount)),
    )
  )
    throw new RegistrationError(
      "CONCURRENT_UPDATE",
      "La lista cambió. Vuelve a exportarla.",
    );
  return {
    ...row,
    cashNetCents: Number(cash),
    qrNetCents: Number(qr),
    unrecordedMethodNetCents: Number(unrecorded),
    receivedNetCents: Number(received),
  };
}
