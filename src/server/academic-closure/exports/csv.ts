import type { ClosureVersionDto } from "@/domain/academic-closure/types";
import { csvText } from "@/server/pre-registrations/exports/csv";
import { gradeText, validateOfficialVersion } from "./document";

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
    "UUID responsable",
    "Nota mínima",
    "Límite ausencias consecutivas",
    "Nombres",
    "Apellidos",
    ...(r.access === "ADMIN" ? ["CI"] : []),
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
    version.actorId,
    gradeText(String(r.minimumGrade)),
    String(r.attendanceSettings.consecutiveAbsenceLimit),
  ];
  const lines = [header.map((v) => csvText(v)).join(";")];
  for (const p of r.participants) {
    const cells = [
      ...metadata.map((v) => csvText(v)),
      csvText(p.firstName),
      csvText(p.lastName),
    ];
    if (r.access === "ADMIN")
      cells.push(
        csvText(
          r.participants.find(
            (person) => person.registrationId === p.registrationId,
          )!.ci,
          true,
        ),
      );
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
