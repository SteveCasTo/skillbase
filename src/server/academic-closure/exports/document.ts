import type {
  AuthorizedClosureReportDto,
  ClosureVersionDto,
} from "@/domain/academic-closure/types";
import {
  evaluationDecimal,
  evaluationHundredths,
} from "@/domain/evaluations/rules";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";

export class ClosureExportError extends Error {
  constructor() {
    super(
      "La versión histórica no contiene evidencia completa para generar el documento oficial.",
    );
    this.name = "ClosureExportError";
  }
}
export function gradeText(value: string | null): string {
  if (value === null) throw new ClosureExportError();
  try {
    return evaluationDecimal(evaluationHundredths(value, "score"));
  } catch {
    throw new ClosureExportError();
  }
}
/** Validate the historical evidence, never repair it using live course/settings data. */
export function validateOfficialVersion(version: ClosureVersionDto): void {
  const report: AuthorizedClosureReportDto = version.report;
  if (
    !Number.isSafeInteger(version.version) ||
    version.version < 1 ||
    !Number.isFinite(Date.parse(version.closedAt)) ||
    !version.actorId ||
    !version.actorName ||
    !Number.isFinite(report.minimumGrade) ||
    report.minimumGrade < 0 ||
    report.minimumGrade > 100
  )
    throw new ClosureExportError();
  const components = report.scheme.components;
  if (new Set(components.map((c) => c.id)).size !== components.length)
    throw new ClosureExportError();
  for (const component of components) gradeText(component.weight);
  for (const person of report.participants) {
    if (
      person.membershipStatus !== "INSCRITO" ||
      person.groupId !== report.groupId ||
      person.result.status !== "COMPLETE" ||
      person.result.missingComponentIds.length ||
      person.attendance.pending !== 0 ||
      person.academicallyPassed !==
        (person.result.passed && person.attendance.academicallyEligible)
    )
      throw new ClosureExportError();
    gradeText(person.result.finalGrade);
    if (
      person.grades.length !== components.length ||
      new Set(person.grades.map((g) => g.componentId)).size !==
        components.length
    )
      throw new ClosureExportError();
    for (const component of components)
      gradeText(
        person.grades.find((g) => g.componentId === component.id)?.score ??
          null,
      );
    for (const count of [
      person.attendance.present,
      person.attendance.absent,
      person.attendance.excused,
      person.attendance.maximumConsecutiveAbsences,
    ])
      if (!Number.isSafeInteger(count) || count < 0)
        throw new ClosureExportError();
  }
  for (const session of report.sessions.filter((s) => !s.cancelledAt)) {
    if (
      session.administrativeReviewRequired ||
      session.instructorAttendance.status === "PENDING" ||
      session.participants.some((p) => p.attendance.status === "PENDING")
    )
      throw new ClosureExportError();
  }
}
export function closureMetadata(version: ClosureVersionDto): string[] {
  const r = version.report;
  return [
    `Curso: ${r.courseName}`,
    `Grupo: ${r.groupName}`,
    `Instructor al cierre: ${r.instructorName ?? "Sin instructor"}`,
    `Cierre: ${instantToBoliviaCivil(new Date(version.closedAt)).replace("T", " ")} (Bolivia UTC-04)`,
    `Responsable: ${version.actorName} / ${version.actorId}`,
    `Versión: ${version.version} / ${version.id}`,
    `Nota mínima histórica: ${gradeText(String(r.minimumGrade))} / 100`,
    `Límite histórico de ausencias consecutivas: ${r.attendanceSettings.consecutiveAbsenceLimit}`,
    "Resultado académico = nota aprobada y elegibilidad de asistencia. No es un certificado.",
  ];
}
export function closureSummary(report: AuthorizedClosureReportDto): string[] {
  const people = report.participants;
  const effective = report.sessions.filter((s) => !s.cancelledAt);
  const instructor = (status: string) =>
    effective.filter((s) => s.instructorAttendance.status === status).length;
  return [
    `Participantes: ${people.length} / Nota aprobada: ${people.filter((p) => p.result.passed).length} / Aprobación académica final: ${people.filter((p) => p.academicallyPassed).length}`,
    `No aprobados académicamente: ${people.filter((p) => !p.academicallyPassed).length} / No elegibles por asistencia: ${people.filter((p) => !p.attendance.academicallyEligible).length}`,
    `Sesiones efectivas: ${effective.length} / Canceladas excluidas: ${report.sessions.length - effective.length} / Recuperaciones efectivas: ${effective.filter((s) => s.replacementForSessionId).length}`,
    // Participant totals are the authoritative recovery-family projection, not a sum of raw session marks.
    `Asistencia participantes (evidencia efectiva): presentes ${people.reduce((n, p) => n + p.attendance.present, 0)} / ausentes ${people.reduce((n, p) => n + p.attendance.absent, 0)} / justificadas ${people.reduce((n, p) => n + p.attendance.excused, 0)}`,
    `Marcas instructor en sesiones no canceladas: presentes ${instructor("PRESENT")} / ausentes ${instructor("ABSENT")} / justificadas ${instructor("EXCUSED")}`,
  ];
}
