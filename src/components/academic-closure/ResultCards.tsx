import { useState, useSyncExternalStore } from "react";
import { participantFullName } from "@/domain/pre-registrations/participant-name";
import { X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AuthorizedClosureReportDto } from "@/domain/academic-closure/types";
import { gradeLabel } from "@/components/evaluations/presentation";

type Person = AuthorizedClosureReportDto["participants"][number];
type Props = { report: AuthorizedClosureReportDto };
type PersonProps = Props & { person: Person };

function ResultStatus({ person }: { person: Person }) {
  const pending = person.result.status === "PENDING";
  return (
    <Badge
      variant={
        pending ? "secondary" : person.result.passed ? "default" : "destructive"
      }
    >
      {pending
        ? "Pendiente"
        : person.result.passed
          ? "Aprobado"
          : "No aprobado"}
    </Badge>
  );
}

function FinalGrade({ report, person }: PersonProps) {
  const pending =
    person.result.status === "PENDING" || person.result.finalGrade === null;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
      <span className="text-muted-foreground text-xs">Nota final</span>
      <span
        className="text-lg font-semibold tabular-nums"
        aria-label={pending ? "Nota final pendiente" : undefined}
      >
        {pending ? "—" : gradeLabel(person.result.finalGrade!)}
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">
        Mín. {gradeLabel(String(report.minimumGrade))}
      </span>
    </span>
  );
}

function Grades({ report, person }: PersonProps) {
  return (
    <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-4 gap-y-3">
      {report.scheme.components.map((component) => {
        const score = person.grades.find(
          (grade) => grade.componentId === component.id,
        )?.score;
        return (
          <div key={component.id} className="flex min-w-0 flex-col gap-1">
            <dt className="text-muted-foreground text-xs break-words">
              {component.name} ({gradeLabel(component.weight)} %)
            </dt>
            <dd className="text-sm tabular-nums">
              {score == null ? "Pendiente" : gradeLabel(score)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Attendance({ report, person }: PersonProps) {
  const attendance = person.attendance;
  const categories = [
    { label: "presentes", count: attendance.present, color: "bg-primary" },
    { label: "ausentes", count: attendance.absent, color: "bg-destructive" },
    {
      label: "justificadas",
      count: attendance.excused,
      color: "bg-muted border border-border",
    },
    ...(attendance.pending
      ? [
          {
            label: "pendientes",
            count: attendance.pending,
            color: "bg-background border border-border",
          },
        ]
      : []),
  ];
  const total = categories.reduce((sum, category) => sum + category.count, 0);
  const blockedByStreak =
    !attendance.academicallyEligible &&
    attendance.maximumConsecutiveAbsences >
      report.attendanceSettings.consecutiveAbsenceLimit;
  return (
    <span className="flex min-w-0 flex-col gap-2">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Asistencia</span>
        <Badge
          variant={attendance.academicallyEligible ? "outline" : "destructive"}
          className="max-w-full whitespace-normal"
        >
          {attendance.academicallyEligible
            ? "Asistencia elegible"
            : "Asistencia no elegible"}
          {blockedByStreak
            ? ` · racha de ${attendance.maximumConsecutiveAbsences}`
            : ""}
        </Badge>
      </span>
      <span
        role="img"
        aria-label={
          total
            ? `Asistencia: ${categories.map((category) => `${category.count} ${category.label}`).join(", ")}; ${total} sesiones en total.`
            : "Asistencia: sin sesiones computables."
        }
        className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full"
      >
        {categories
          .filter((category) => category.count > 0)
          .map((category) => (
            <span
              key={category.label}
              aria-hidden="true"
              className={category.color}
              style={{ width: `${(category.count / total) * 100}%` }}
            />
          ))}
      </span>
      <span
        className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums"
        aria-hidden="true"
      >
        {categories.map((category) => (
          <span
            key={category.label}
            className="inline-flex items-center gap-1.5"
          >
            <span
              className={cn("size-2 shrink-0 rounded-full", category.color)}
            />
            {category.count}/{total} {category.label}
          </span>
        ))}
      </span>
    </span>
  );
}

function PrivateIdentity({ report, person }: PersonProps) {
  if (report.access !== "ADMIN") return null;
  const privatePerson = report.participants.find(
    (entry) => entry.registrationId === person.registrationId,
  );
  return privatePerson ? (
    <span className="text-muted-foreground text-xs break-words">
      CI: {privatePerson.ci}
    </span>
  ) : null;
}

function Summary({ report, person }: PersonProps) {
  const completed = report.scheme.components.filter((component) =>
    person.grades.some(
      (grade) => grade.componentId === component.id && grade.score != null,
    ),
  ).length;
  return (
    <span className="flex min-w-0 flex-col gap-3">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold break-words">
          {participantFullName(person)}
        </span>
        <PrivateIdentity report={report} person={person} />
      </span>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <ResultStatus person={person} />
        <FinalGrade report={report} person={person} />
      </span>
      {report.scheme.components.length > 0 && (
        <span className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">
            {completed} de {report.scheme.components.length} notas calificadas
          </span>
          <progress
            value={completed}
            max={report.scheme.components.length}
            aria-label="Notas calificadas"
            className="[&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary h-1.5 w-full overflow-hidden rounded-full"
          />
        </span>
      )}
      <Attendance report={report} person={person} />
    </span>
  );
}

function DetailCard({ report, person }: PersonProps) {
  const [open, setOpen] = useState(false);
  const enhanced = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!enhanced)
    return (
      <details className="bg-card min-w-0 rounded-xl border p-4 sm:p-5">
        <summary className="focus-visible:outline-ring cursor-pointer list-none focus-visible:outline-2 focus-visible:outline-offset-2">
          <Summary report={report} person={person} />
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <Grades report={report} person={person} />
        </div>
      </details>
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Ver resultados de ${participantFullName(person)}`}
          className="bg-card hover:bg-muted/50 focus-visible:outline-ring h-full w-full min-w-0 cursor-pointer rounded-xl border p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 sm:p-5"
        >
          <Summary report={report} person={person} />
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[85dvh] sm:max-w-2xl"
        showCloseButton={false}
      >
        <DialogHeader className="pr-10 text-left">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <DialogTitle className="leading-snug break-words">
              {participantFullName(person)}
            </DialogTitle>
            <PrivateIdentity report={report} person={person} />
          </span>
          <DialogDescription className="sr-only">
            Desglose de calificaciones y asistencia.
          </DialogDescription>
        </DialogHeader>
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 min-h-11 min-w-11"
            aria-label="Cerrar"
          >
            <X aria-hidden="true" />
          </Button>
        </DialogClose>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ResultStatus person={person} />
            <FinalGrade report={report} person={person} />
          </div>
          <Grades report={report} person={person} />
          <Attendance report={report} person={person} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ResultCards({ report }: Props) {
  return (
    <ul className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
      {report.participants.map((person) => (
        <li key={person.registrationId} className="min-w-0">
          <DetailCard report={report} person={person} />
        </li>
      ))}
    </ul>
  );
}
