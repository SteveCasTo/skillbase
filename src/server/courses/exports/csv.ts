import type { CourseReport } from "@/application/courses/course-report";
import { courseAcademicPhaseLabels } from "@/domain/courses/academic-phase";
import { csvText } from "@/server/exports/csv-text";
import {
  groupSchedule,
  levelLabels,
  reportDate,
  reportDecimal,
  statusLabels,
} from "./columns";

/** Group metrics only: no repeated course subtotals that double-count money.
 * A course without groups has one row with an empty group and zero metrics. */
export function renderCoursesCsv(report: CourseReport): Uint8Array {
  const headers = [
    "Curso",
    "Nivel",
    "Estado editorial",
    "Fase académica",
    "Inicio del curso",
    "Fin del curso",
    "Instructor",
    "Precio estudiante BOB",
    "Precio externo BOB",
    "Precio auxiliar BOB",
    "Cantidad de grupos",
    "Grupo",
    "Inicio del grupo",
    "Fin del grupo",
    "Horario",
    "Inscritos del grupo",
    "Recaudación neta BOB",
    "Aprobados",
    "No aprobados",
  ];
  const lines = [headers.map((value) => csvText(value)).join(",")];
  for (const course of report.courses) {
    for (const group of course.groups.length ? course.groups : [null]) {
      const text = [
        course.name,
        levelLabels[course.level],
        statusLabels[course.status],
        courseAcademicPhaseLabels[course.phase],
        reportDate(course.startsAt),
        reportDate(course.endsAt),
        course.instructorName,
      ];
      lines.push(
        [
          ...text.map((value) => csvText(value)),
          reportDecimal(course.studentCents),
          reportDecimal(course.externalCents),
          reportDecimal(course.auxiliaryCents),
          course.groups.length,
          csvText(group ? `Grupo ${group.number}` : ""),
          csvText(group ? reportDate(group.startsAt) : ""),
          csvText(group ? reportDate(group.endsAt) : ""),
          csvText(group ? groupSchedule(group) : ""),
          group?.enrolled ?? 0,
          reportDecimal(group?.netCents ?? "0"),
          group?.passed ?? "",
          group?.notPassed ?? "",
        ].join(","),
      );
    }
  }
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}
