import { requireRoles } from "@/application/auth/authorize";
import type { InternalUser } from "@/domain/auth/types";
import { AuthorizationError } from "@/domain/auth/errors";
import {
  courseAcademicPhase,
  type CourseAcademicPhase,
} from "@/domain/courses/academic-phase";
import type { CourseLevel, CourseStatus } from "@/domain/courses/types";
import {
  courseListStatus,
  type CourseReportFilter,
} from "@/domain/courses/report-filters";
import { normalizeRegistrationSearch } from "@/domain/pre-registrations/search";
import { membershipStatus } from "@/domain/pre-registrations/policies";

export const COURSE_REPORT_LIMIT = 1000;
export class CourseReportError extends Error {
  constructor(
    readonly code:
      | "VALIDATION_FAILED"
      | "EXPORT_LIMIT_EXCEEDED"
      | "EMPTY_REPORT"
      | "INCONSISTENT_REPORT"
      | "PDF_UNSUPPORTED_TEXT",
    message: string,
  ) {
    super(message);
  }
}
export interface CourseReportSource {
  courses: {
    id: string;
    name: string;
    level: CourseLevel;
    status: CourseStatus;
    startsAt: Date;
    endsAt: Date;
    instructorName: string | null;
    studentCents: string;
    externalCents: string;
    auxiliaryCents: string;
    weekdaysMask: number | null;
  }[];
  groups: {
    id: string;
    courseId: string;
    startsAt: Date;
    endsAt: Date;
    status: "PLANNED" | "CANCELLED";
    closed: boolean;
    lastVersion: number;
    officialVersion: number | null;
    officialParticipants: unknown;
  }[];
  sessions: { groupId: string; startsAt: Date; endsAt: Date }[];
  registrations: {
    id: string;
    participantId: string;
    courseId: string;
    groupId: string;
    state: "ACTIVE" | "CANCELLED";
    totalCents: string;
    paidCents: string;
    refundedCents: string;
  }[];
}
export interface CourseReportRepository {
  read(
    actorId: string,
    filter: CourseReportFilter,
    now: Date,
  ): Promise<CourseReportSource>;
}
export interface CourseReportGroup {
  number: number;
  startsAt: Date;
  endsAt: Date;
  schedules: { startsAt: Date; endsAt: Date }[];
  weekdaysMask: number | null;
  enrolled: number;
  netCents: string;
  passed: number | null;
  notPassed: number | null;
}
export interface CourseReportCourse {
  name: string;
  level: CourseLevel;
  status: CourseStatus;
  phase: CourseAcademicPhase;
  startsAt: Date;
  endsAt: Date;
  instructorName: string;
  studentCents: string;
  externalCents: string;
  auxiliaryCents: string;
  enrolled: number;
  netCents: string;
  groups: CourseReportGroup[];
}
export interface CourseReport {
  generatedAt: Date;
  filter: CourseReportFilter;
  courses: CourseReportCourse[];
  uniqueEnrolled: number;
  netCents: string;
  groupCount: number;
}
export function parseCourseReportFilter(input: {
  search?: string | null;
  status?: string | null;
}): CourseReportFilter {
  if (
    input.status != null &&
    !["ALL", "PUBLISHED", "DRAFT", "ARCHIVED"].includes(input.status)
  )
    throw new CourseReportError(
      "VALIDATION_FAILED",
      "Selecciona un estado de curso válido.",
    );
  if ((input.search?.length ?? 0) > 500)
    throw new CourseReportError(
      "VALIDATION_FAILED",
      "Acorta la búsqueda antes de exportar.",
    );
  return {
    search: normalizeRegistrationSearch(input.search ?? ""),
    status: courseListStatus(input.status ?? null),
  };
}
function inconsistent(): never {
  throw new CourseReportError(
    "INCONSISTENT_REPORT",
    "No se pudo conciliar el informe. Revisa los datos del curso e inténtalo nuevamente.",
  );
}
export function reportCents(value: string): bigint {
  if (!/^-?\d+$/u.test(value)) return inconsistent();
  return BigInt(value);
}
function officialResults(
  group: CourseReportSource["groups"][number],
  registrations: CourseReportSource["registrations"],
): { passed: number | null; notPassed: number | null } {
  if (!group.closed) return { passed: null, notPassed: null };
  if (
    group.lastVersion < 1 ||
    group.officialVersion !== group.lastVersion ||
    !Array.isArray(group.officialParticipants)
  )
    return inconsistent();
  const results = new Map<string, { participantId: string; passed: boolean }>();
  for (const row of group.officialParticipants) {
    if (
      typeof row !== "object" ||
      row === null ||
      !("registrationId" in row) ||
      typeof row.registrationId !== "string" ||
      !("participantId" in row) ||
      typeof row.participantId !== "string" ||
      !("academicallyPassed" in row) ||
      typeof row.academicallyPassed !== "boolean" ||
      results.has(row.registrationId)
    )
      return inconsistent();
    results.set(row.registrationId, {
      participantId: row.participantId,
      passed: row.academicallyPassed,
    });
  }
  const people = new Map<string, boolean>();
  for (const row of registrations) {
    const result = results.get(row.id);
    if (!result || result.participantId !== row.participantId)
      return inconsistent();
    const previous = people.get(row.participantId);
    if (previous !== undefined && previous !== result.passed)
      return inconsistent();
    people.set(row.participantId, result.passed);
  }
  const passed = [...people.values()].filter(Boolean).length;
  return { passed, notPassed: people.size - passed };
}
export function buildCourseReport(
  source: CourseReportSource,
  filter: CourseReportFilter,
  generatedAt: Date,
): CourseReport {
  if (
    source.courses.length > COURSE_REPORT_LIMIT ||
    source.groups.length > COURSE_REPORT_LIMIT
  )
    throw new CourseReportError(
      "EXPORT_LIMIT_EXCEEDED",
      "El informe supera 1000 cursos o grupos. Acota los filtros e inténtalo nuevamente.",
    );
  if (!source.courses.length)
    throw new CourseReportError(
      "EMPTY_REPORT",
      "No hay cursos que coincidan con los filtros.",
    );
  const allPeople = new Set<string>();
  let net = 0n;
  const seen = new Set<string>();
  const courses = source.courses.map((course): CourseReportCourse => {
    const registrations = source.registrations.filter((row) => {
      if (row.courseId !== course.id) return false;
      const balance = reportCents(row.totalCents) - reportCents(row.paidCents);
      if (balance < 0n || balance > BigInt(Number.MAX_SAFE_INTEGER))
        return inconsistent();
      return (
        membershipStatus(
          row.state,
          Number(balance),
          course.startsAt,
          generatedAt,
        ) === "INSCRITO"
      );
    });
    const people = new Set(registrations.map((row) => row.participantId));
    people.forEach((id) => allPeople.add(id));
    const groups = source.groups
      .filter((group) => group.courseId === course.id)
      .sort(
        (a, b) =>
          a.startsAt.getTime() - b.startsAt.getTime() ||
          a.endsAt.getTime() - b.endsAt.getTime() ||
          a.id.localeCompare(b.id),
      );
    let courseNet = 0n;
    const projected = groups.map((group, index): CourseReportGroup => {
      const members = registrations.filter((row) => row.groupId === group.id);
      let groupNet = 0n;
      for (const member of members) {
        if (seen.has(member.id)) return inconsistent();
        seen.add(member.id);
        groupNet +=
          reportCents(member.paidCents) - reportCents(member.refundedCents);
      }
      courseNet += groupNet;
      const sessions = source.sessions
        .filter((session) => session.groupId === group.id)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      const startsAt = sessions[0]?.startsAt ?? group.startsAt;
      const endsAt = sessions.length
        ? new Date(
            Math.max(...sessions.map((session) => session.endsAt.getTime())),
          )
        : group.endsAt;
      return {
        number: index + 1,
        startsAt,
        endsAt,
        schedules: sessions.length
          ? sessions
          : [{ startsAt: group.startsAt, endsAt: group.endsAt }],
        weekdaysMask: sessions.length ? null : course.weekdaysMask,
        enrolled: new Set(members.map((row) => row.participantId)).size,
        netCents: groupNet.toString(),
        ...officialResults(group, members),
      };
    });
    if (registrations.some((row) => !seen.has(row.id))) return inconsistent();
    net += courseNet;
    return {
      name: course.name,
      level: course.level,
      status: course.status,
      startsAt: course.startsAt,
      endsAt: course.endsAt,
      instructorName: course.instructorName?.trim() || "Sin asignar",
      studentCents: course.studentCents,
      externalCents: course.externalCents,
      auxiliaryCents: course.auxiliaryCents,
      phase: courseAcademicPhase(
        groups.map((group) => ({ ...group, academicallyClosed: group.closed })),
        generatedAt,
      ),
      enrolled: people.size,
      netCents: courseNet.toString(),
      groups: projected,
    };
  });
  if (
    courses.reduce(
      (count, course) => count + Math.max(1, course.groups.length),
      0,
    ) > COURSE_REPORT_LIMIT
  )
    throw new CourseReportError(
      "EXPORT_LIMIT_EXCEEDED",
      "El informe supera 1000 filas de cursos o grupos. Acota los filtros e inténtalo nuevamente.",
    );
  return {
    generatedAt,
    filter,
    courses,
    uniqueEnrolled: allPeople.size,
    netCents: net.toString(),
    groupCount: source.groups.length,
  };
}
export async function loadCourseReport(
  repository: CourseReportRepository,
  user: InternalUser,
  input: { search?: string | null; status?: string | null },
  now = new Date(),
): Promise<CourseReport> {
  if (user.status !== "ACTIVE")
    throw new AuthorizationError("DISABLED", "La cuenta no está activa.");
  requireRoles(user, ["ADMIN"]);
  const filter = parseCourseReportFilter(input);
  return buildCourseReport(
    await repository.read(user.id, filter, now),
    filter,
    now,
  );
}
