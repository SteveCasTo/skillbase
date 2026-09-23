import type { PublicCourseDto } from "@/domain/courses/types";

export const previewCourses: readonly PublicCourseDto[] = [
  {
    slug: "fundamentos-de-python",
    name: "Fundamentos de Python",
    description: "Programación práctica desde los fundamentos.",
    level: "BASIC",
    totalHours: 24,
    schedule: "Martes y jueves · 18:30",
    conditions: "Datos sintéticos para revisar la composición visual.",
    startsAt: new Date("2026-10-07T22:30:00.000Z"),
    endsAt: new Date("2026-11-01T22:30:00.000Z"),
    registrationStartAt: new Date("2026-09-01T04:00:00.000Z"),
    registrationEndAt: new Date("2026-10-01T03:59:59.000Z"),
    registrationAvailability: "OPEN",
    prices: [
      { participantType: "STUDENT", amount: "180", currency: "BOB" },
      { participantType: "EXTERNAL", amount: "260", currency: "BOB" },
    ],
  },
  {
    slug: "redes-para-entornos-linux",
    name: "Redes para entornos Linux",
    description: "Configuración y diagnóstico de redes en entornos Linux.",
    level: "INTERMEDIATE",
    totalHours: 30,
    schedule: "Lunes y miércoles · 19:00",
    conditions: "Datos sintéticos para revisar la composición visual.",
    startsAt: new Date("2026-10-14T23:00:00.000Z"),
    endsAt: new Date("2026-11-18T23:00:00.000Z"),
    registrationStartAt: new Date("2026-10-01T04:00:00.000Z"),
    registrationEndAt: new Date("2026-10-12T03:59:59.000Z"),
    registrationAvailability: "UPCOMING",
    prices: [
      { participantType: "STUDENT", amount: "220", currency: "BOB" },
      { participantType: "EXTERNAL", amount: "310", currency: "BOB" },
    ],
  },
  {
    slug: "bases-de-datos-con-postgresql",
    name: "Bases de datos con PostgreSQL",
    description: "Diseño y consulta de bases de datos relacionales.",
    level: "BASIC",
    totalHours: 28,
    schedule: "Sábados · 08:30",
    conditions: "Datos sintéticos para revisar la composición visual.",
    startsAt: new Date("2026-08-08T12:30:00.000Z"),
    endsAt: new Date("2026-09-05T12:30:00.000Z"),
    registrationStartAt: new Date("2026-07-01T04:00:00.000Z"),
    registrationEndAt: new Date("2026-08-02T03:59:59.000Z"),
    registrationAvailability: "CLOSED",
    prices: [
      { participantType: "STUDENT", amount: "200", currency: "BOB" },
      { participantType: "EXTERNAL", amount: "290", currency: "BOB" },
    ],
  },
];

export function previewCoursesForCount(
  count: number,
): readonly PublicCourseDto[] {
  const safeCount = Math.max(1, Math.min(20, Math.trunc(count)));
  return Array.from({ length: safeCount }, (_, index) => {
    const source = previewCourses[index % previewCourses.length];
    if (!source) throw new Error("Preview courses must not be empty");
    if (index < previewCourses.length) return source;

    return {
      ...source,
      slug: `${source.slug}-${index + 1}`,
      name: `${source.name} · edición ${index + 1}`,
    };
  });
}
