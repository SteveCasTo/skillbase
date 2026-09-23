import type {
  CourseLevel,
  PublicCourseDto,
  RegistrationAvailability,
} from "@/domain/courses/types";

export const levelLabels: Readonly<Record<CourseLevel, string>> = {
  BASIC: "Básico",
  INTERMEDIATE: "Medio",
  ADVANCED: "Avanzado",
};

export const availabilityLabels: Readonly<
  Record<RegistrationAvailability, string>
> = {
  UNAVAILABLE: "Preinscripción no disponible",
  UPCOMING: "Preinscripción próxima",
  OPEN: "Preinscripción abierta",
  CLOSED: "Preinscripción cerrada",
};

export const landingDateFormatter = new Intl.DateTimeFormat("es-BO", {
  day: "numeric",
  month: "short",
  timeZone: "America/La_Paz",
});

export function courseDateRange(course: PublicCourseDto): string {
  return `${landingDateFormatter.format(course.startsAt)} — ${landingDateFormatter.format(course.endsAt)}`;
}
