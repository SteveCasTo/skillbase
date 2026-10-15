import { centsToDecimal } from "@/domain/pre-registrations/money";
import type { AdminRegistrationDto } from "@/domain/pre-registrations/types";
import type { RegistrationExportRow } from "@/application/pre-registrations/export-finance";

export const PARTICIPANT_LABELS = {
  STUDENT: "Estudiante",
  EXTERNAL: "Externo",
  AUXILIARY: "Auxiliar",
} as const;
export const MEMBERSHIP_LABELS = {
  PREINSCRITO: "Preinscrito",
  INSCRITO: "Inscrito",
  SALDOVENCIDO: "Saldo vencido",
  CANCELADO: "Cancelado",
} as const;
export const FINANCE_LABELS = {
  EXEMPT: "Exento",
  UNPAID: "Sin pago",
  PARTIAL: "Pago parcial",
  PAID: "Pagado",
  REFUND_DUE: "Devolución pendiente",
  REFUNDED: "Devuelto",
} as const;
export const MONEY_COLUMNS = [
  {
    label: "Precio BOB",
    value: (row: AdminRegistrationDto) => row.price.totalPriceCents,
  },
  { label: "Pagado BOB", value: (row: AdminRegistrationDto) => row.paidCents },
  {
    label: "Saldo BOB",
    value: (row: AdminRegistrationDto) => row.balanceCents,
  },
  {
    label: "Devuelto BOB",
    value: (row: AdminRegistrationDto) => row.refundedCents,
  },
  {
    label: "Por devolver BOB",
    value: (row: AdminRegistrationDto) => row.refundDueCents,
  },
] as const;
export function registrationAmounts(row: AdminRegistrationDto): string[] {
  return MONEY_COLUMNS.map((column) => centsToDecimal(column.value(row)));
}

export const NET_COLUMNS = [
  {
    label: "Efectivo neto BOB",
    value: (row: RegistrationExportRow) => row.cashNetCents,
  },
  {
    label: "QR neto BOB",
    value: (row: RegistrationExportRow) => row.qrNetCents,
  },
  {
    label: "No registrado neto BOB",
    value: (row: RegistrationExportRow) => row.unrecordedMethodNetCents,
  },
  {
    label: "Recibido neto BOB",
    value: (row: RegistrationExportRow) => row.receivedNetCents,
  },
] as const;

/** BigInt also formats report-wide sums beyond a single tariff's bound. */
export function reportDecimal(cents: bigint | number): string {
  if (typeof cents === "number" && !Number.isSafeInteger(cents))
    throw new RangeError("Invalid report cents");
  const amount = BigInt(cents);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

/** Additive private-list labels are supplied by the authorized repository.
 * Property guards keep this renderer compatible with the frozen foundation;
 * only legacy rows without a nonempty name fall back to a marked identifier.
 */
export function registrationDisplayNames(row: AdminRegistrationDto): {
  readonly course: string;
  readonly group: string;
} {
  return {
    course:
      "courseName" in row &&
      typeof row.courseName === "string" &&
      row.courseName.trim()
        ? row.courseName
        : `Curso [${row.courseId}]`,
    group:
      "groupName" in row &&
      typeof row.groupName === "string" &&
      row.groupName.trim()
        ? row.groupName
        : `Grupo [${row.groupId}]`,
  };
}
