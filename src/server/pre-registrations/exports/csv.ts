import type { AdminRegistrationDto } from "@/domain/pre-registrations/types";
import {
  FINANCE_LABELS,
  MEMBERSHIP_LABELS,
  MONEY_COLUMNS,
  PARTICIPANT_LABELS,
  registrationAmounts,
  registrationDisplayNames,
} from "./columns";

/** Quotes alone do not prevent spreadsheet formulas. Retain the original text
 * after the apostrophe, including leading whitespace/control/format characters.
 */
export function csvText(value: string, identifier = false): string {
  const unsafe =
    /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(value) ||
    /^[\s\p{Cc}\p{Cf}]*[\t\r\n]/u.test(value);
  const safe = identifier || unsafe ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function renderRegistrationsCsv(
  rows: readonly AdminRegistrationDto[],
): Uint8Array {
  const header = [
    "Curso",
    "Grupo",
    "Nombres",
    "Apellidos",
    "CI",
    "Categoría",
    "Estado",
    "Estado financiero",
    ...MONEY_COLUMNS.map((column) => column.label),
  ];
  const lines = [header.map((value) => csvText(value)).join(",")];
  for (const row of rows) {
    const names = registrationDisplayNames(row);
    lines.push(
      [
        csvText(names.course),
        csvText(names.group),
        csvText(row.participant.firstName),
        csvText(row.participant.lastName),
        csvText(row.participant.ci, true),
        csvText(PARTICIPANT_LABELS[row.price.participantType]),
        csvText(MEMBERSHIP_LABELS[row.membershipStatus]),
        csvText(FINANCE_LABELS[row.financialStatus]),
        ...registrationAmounts(row),
      ].join(","),
    );
  }
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}
