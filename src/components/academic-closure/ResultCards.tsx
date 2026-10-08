import { useState, useSyncExternalStore } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { AuthorizedClosureReportDto } from "@/domain/academic-closure/types";
import { gradeLabel } from "@/components/evaluations/presentation";
import { formatMoney } from "@/components/pre-registrations/presentation";

/** Presentation boundary only: it never changes academic calculations or exports. */
export const VISIBLE_RESULT_COMPONENTS = 6;
type Person = AuthorizedClosureReportDto["participants"][number];
type Props = { report: AuthorizedClosureReportDto };

function status(person: Person) {
  return person.result.status === "PENDING"
    ? "Resultado pendiente"
    : person.academicallyPassed
      ? "Aprobado por nota y asistencia"
      : "No aprobado por nota y asistencia";
}
function Grades({ report, person }: Props & { person: Person }) {
  return (
    <span className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {report.scheme.components.map((component) => {
        const score = person.grades.find(
          (grade) => grade.componentId === component.id,
        )?.score;
        return (
          <span key={component.id} className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-xs break-words">
              {component.name} ({gradeLabel(component.weight)} %)
            </span>
            <span className="text-sm tabular-nums">
              {score == null ? "Pendiente" : gradeLabel(score)}
            </span>
          </span>
        );
      })}
    </span>
  );
}
function Attendance({ person }: { person: Person }) {
  const attendance = person.attendance;
  return (
    <span className="text-muted-foreground flex flex-wrap gap-x-2 gap-y-1 text-xs">
      <span>
        Asistencia: {attendance.present} presentes · {attendance.excused}{" "}
        justificadas · {attendance.absent} ausentes
        {attendance.pending ? ` · ${attendance.pending} pendientes` : ""}
      </span>
      <span>
        {attendance.academicallyEligible ? "Elegible" : "No elegible"} · Racha
        máxima: {attendance.maximumConsecutiveAbsences}
      </span>
    </span>
  );
}
function PrivateIdentity({ report, person }: Props & { person: Person }) {
  if (report.access !== "ADMIN") return null;
  const privatePerson = report.participants.find(
    (entry) => entry.registrationId === person.registrationId,
  );
  return privatePerson ? (
    <span className="text-muted-foreground block text-xs break-words">
      CI: {privatePerson.ci} · Saldo informativo:{" "}
      {privatePerson.balanceCents === null
        ? "No disponible"
        : formatMoney(privatePerson.balanceCents)}
    </span>
  ) : null;
}
function Summary({
  report,
  person,
  detailed,
}: Props & { person: Person; detailed: boolean }) {
  const completed = report.scheme.components.filter((component) =>
    person.grades.some(
      (grade) => grade.componentId === component.id && grade.score != null,
    ),
  ).length;
  return (
    <span className="flex min-w-0 flex-col gap-4">
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-semibold break-words">
            {person.firstName} {person.lastName}
          </span>
          <span className="text-muted-foreground text-xs">
            {status(person)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-muted-foreground text-xs">Nota final</span>
          <span className="font-semibold tabular-nums">
            {person.result.status === "PENDING" ||
            person.result.finalGrade === null
              ? "Pendiente"
              : gradeLabel(person.result.finalGrade)}
          </span>
          <span className="text-muted-foreground text-xs">
            Mín. {gradeLabel(String(report.minimumGrade))}
          </span>
        </span>
      </span>
      {detailed ? (
        <span className="flex flex-col gap-2">
          <span className="flex flex-wrap justify-between gap-2 text-sm">
            <span>
              {completed}/{report.scheme.components.length} componentes
              calificados
            </span>
            <span className="text-muted-foreground">Ver detalle</span>
          </span>
          <progress
            value={completed}
            max={report.scheme.components.length || 1}
            aria-label="Componentes calificados"
            className="[&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary h-1.5 w-full overflow-hidden rounded-full"
          />
        </span>
      ) : (
        <Grades report={report} person={person} />
      )}
      <Attendance person={person} />
      <PrivateIdentity report={report} person={person} />
    </span>
  );
}
function DetailCard({ report, person }: Props & { person: Person }) {
  const [open, setOpen] = useState(false);
  const enhanced = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!enhanced)
    return (
      <details className="bg-card min-w-0 rounded-xl border p-4 sm:p-5">
        <summary className="focus-visible:outline-ring cursor-pointer list-none focus-visible:outline-2">
          <Summary report={report} person={person} detailed />
        </summary>
        <div className="mt-4">
          <Grades report={report} person={person} />
        </div>
      </details>
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Ver resultados de ${person.firstName} ${person.lastName}`}
          className="bg-card hover:bg-muted/50 focus-visible:outline-ring h-full w-full min-w-0 rounded-xl border p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 sm:p-5"
        >
          <Summary report={report} person={person} detailed />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-5 break-words">
            {person.firstName} {person.lastName}
          </DialogTitle>
          <DialogDescription>{status(person)}</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-4">
          <p className="text-sm">
            Nota final:{" "}
            <span className="font-semibold tabular-nums">
              {person.result.status === "PENDING" ||
              person.result.finalGrade === null
                ? "Pendiente"
                : gradeLabel(person.result.finalGrade)}
            </span>{" "}
            · Mínima: {gradeLabel(String(report.minimumGrade))}
          </p>
          <Grades report={report} person={person} />
          <Attendance person={person} />
          <PrivateIdentity report={report} person={person} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function ResultCards({ report }: Props) {
  const detailed = report.scheme.components.length > VISIBLE_RESULT_COMPONENTS;
  return (
    <ul className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
      {report.participants.map((person) => (
        <li key={person.registrationId} className="min-w-0">
          {detailed ? (
            <DetailCard report={report} person={person} />
          ) : (
            <article
              aria-label={`Resultados de ${person.firstName} ${person.lastName}`}
              className="bg-card min-w-0 rounded-xl border p-4 sm:p-5"
            >
              <Summary report={report} person={person} detailed={false} />
            </article>
          )}
        </li>
      ))}
    </ul>
  );
}
