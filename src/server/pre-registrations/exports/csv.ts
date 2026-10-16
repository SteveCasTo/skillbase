import type { RegistrationExportRow } from "@/application/pre-registrations/export-finance";
import {
  FINANCE_LABELS,
  MEMBERSHIP_LABELS,
  MONEY_COLUMNS,
  NET_COLUMNS,
  reportDecimal,
  PARTICIPANT_LABELS,
  registrationAmounts,
  registrationDisplayNames,
} from "./columns";

import { csvText } from "@/server/exports/csv-text";
export { csvText } from "@/server/exports/csv-text";
export function renderRegistrationsCsv(
  rows: readonly RegistrationExportRow[],
): Uint8Array {
  const header = [
    "Curso",
    "Grupo",
    "Nombres",
    "Apellido paterno",
    "Apellido materno",
    "CI",
    "Categoría",
    "Estado",
    "Estado financiero",
    ...MONEY_COLUMNS.map((column) => column.label),
    ...NET_COLUMNS.map((column) => column.label),
    "Responsable del registro",
  ];
  const lines = [header.map((value) => csvText(value)).join(",")];
  for (const row of rows) {
    const names = registrationDisplayNames(row);
    lines.push(
      [
        csvText(names.course),
        csvText(names.group),
        csvText(row.participant.firstName),
        csvText(row.participant.paternalSurname),
        csvText(row.participant.maternalSurname),
        csvText(row.participant.ci, true),
        csvText(PARTICIPANT_LABELS[row.price.participantType]),
        csvText(MEMBERSHIP_LABELS[row.membershipStatus]),
        csvText(FINANCE_LABELS[row.financialStatus]),
        ...registrationAmounts(row),
        ...NET_COLUMNS.map((column) => reportDecimal(column.value(row))),
        csvText(
          row.registeredByName?.trim() ? row.registeredByName : "No registrado",
        ),
      ].join(","),
    );
  }
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}
