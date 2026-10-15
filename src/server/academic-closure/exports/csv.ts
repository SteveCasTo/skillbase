import type {
  ClosureParticipantDto,
  ClosureVersionDto,
} from "@/domain/academic-closure/types";
import { csvText } from "@/server/pre-registrations/exports/csv";
import { PARTICIPANT_LABELS } from "@/server/pre-registrations/exports/columns";
import {
  ClosureExportError,
  gradeText,
  validateOfficialVersion,
} from "./document";

function paymentCells(
  payments: ClosureParticipantDto["receivedPayments"],
): string[] {
  if (!payments) return Array<string>(4).fill(csvText("Sin método registrado"));
  const values = [
    payments.cashCents,
    payments.qrCents,
    payments.unregisteredCents,
    payments.totalCents,
  ];
  if (
    values.some((value) => typeof value !== "string" || !/^-?\d+$/.test(value))
  )
    throw new ClosureExportError();
  const cents = values.map((value) => BigInt(value));
  if (cents[0]! + cents[1]! + cents[2]! !== cents[3]!)
    throw new ClosureExportError();
  return cents.map((value) => {
    const amount = value < 0n ? -value : value;
    // Only validated integer-derived numeric literals bypass formula shielding;
    // negative method nets must remain summable numeric cells in Excel.
    return `"${value < 0n ? "-" : ""}${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}"`;
  });
}

export function renderClosureCsv(version: ClosureVersionDto): Uint8Array {
  validateOfficialVersion(version);
  const r = version.report;
  const components = [...r.scheme.components].sort((a, b) => a.order - b.order);
  const header = [
    "Curso",
    "Grupo",
    "Versión",
    "Cierre UTC",
    "Responsable",
    "Nota mínima",
    "Límite ausencias consecutivas",
    "Nombres",
    "Apellido paterno",
    "Apellido materno",
    ...(r.access === "ADMIN"
      ? [
          "CI",
          "Categoría",
          "Efectivo neto BOB",
          "QR neto BOB",
          "Sin método registrado neto BOB",
          "Total percibido neto BOB",
        ]
      : []),
    ...components.map(
      (c) =>
        `${c.name} (${c.type === "THEORY" ? "Teoría" : "Práctica"}; peso ${gradeText(c.weight)} %)`,
    ),
    "Nota final",
    "Nota aprobada",
    "Presentes",
    "Ausentes",
    "Justificadas",
    "Racha máxima",
    "Elegible por asistencia",
    "Resultado académico",
  ];
  const metadata = [
    r.courseName,
    r.groupName,
    String(version.version),
    version.closedAt,
    version.actorName,
    gradeText(String(r.minimumGrade)),
    String(r.attendanceSettings.consecutiveAbsenceLimit),
  ];
  const lines = [header.map((v) => csvText(v)).join(";")];
  for (const [index, p] of r.participants.entries()) {
    const cells = [
      ...metadata.map((v) => csvText(v)),
      csvText(p.firstName),
      csvText(p.paternalSurname),
      csvText(p.maternalSurname),
    ];
    if (r.access === "ADMIN") {
      const person = r.participants[index]!;
      cells.push(
        csvText(person.ci, true),
        csvText(
          person.participantCategory
            ? PARTICIPANT_LABELS[person.participantCategory]
            : "No registrada",
        ),
        ...paymentCells(person.receivedPayments),
      );
    }
    cells.push(
      ...components.map((c) =>
        csvText(
          gradeText(
            p.grades.find((g) => g.componentId === c.id)?.score ?? null,
          ),
        ),
      ),
      csvText(gradeText(p.result.finalGrade)),
      csvText(p.result.passed ? "Sí" : "No"),
      ...[
        p.attendance.present,
        p.attendance.absent,
        p.attendance.excused,
        p.attendance.maximumConsecutiveAbsences,
      ].map((v) => csvText(String(v))),
      csvText(p.attendance.academicallyEligible ? "Sí" : "No"),
      csvText(p.academicallyPassed ? "Aprobado" : "No aprobado"),
    );
    lines.push(cells.join(";"));
  }
  if (!r.participants.length)
    lines.push(
      [
        ...metadata.map((v) => csvText(v)),
        ...Array.from({ length: header.length - metadata.length }, () =>
          csvText(""),
        ),
      ].join(";"),
    );
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}
