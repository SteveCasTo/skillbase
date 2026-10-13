import { comprehensiveDemoPlan } from "./comprehensive-demo-plan";
import { currentAnchor, validateAnchor } from "./financial-demo-plan";
import type { ComprehensiveDemoPlan } from "./comprehensive-demo-plan";
import { comprehensiveDemoId } from "./comprehensive-demo-plan";
import { shiftedDay } from "./financial-demo-plan";
import { planCourseDates } from "@/domain/courses/weekday-schedule";
import {
  boliviaCivilToInstant,
  instantToBoliviaCivil,
} from "@/domain/courses/bolivia-time";
import { groupPlan } from "@/domain/groups/rules";

/** Planning vocabulary, not a substitute for the current application services.
 * The operator freezes this inventory before RESET/APPLY; no rolling replay. */
export const FULL_VALIDATION_OWNER = "skillbase-validation-v3";

export const FULL_VALIDATION_STUDENT_IDENTITIES = [
  {
    firstName: "Camila",
    paternalSurname: "Valcárcel",
    maternalSurname: "Soria",
  },
  { firstName: "Mateo", paternalSurname: "Arce", maternalSurname: "Villalba" },
  { firstName: "Lucía", paternalSurname: "Quiroga", maternalSurname: "Prado" },
  {
    firstName: "Diego",
    paternalSurname: "Ledesma",
    maternalSurname: "Paredes",
  },
  {
    firstName: "Elena",
    paternalSurname: "Salvatierra",
    maternalSurname: "Ríos",
  },
  {
    firstName: "Andrés",
    paternalSurname: "Cárdenas",
    maternalSurname: "Leiva",
  },
  { firstName: "Sofía", paternalSurname: "Alcázar", maternalSurname: "Molina" },
  {
    firstName: "Valeria",
    paternalSurname: "Rivero",
    maternalSurname: "Salinas",
  },
  {
    firstName: "Daniel",
    paternalSurname: "Mendieta",
    maternalSurname: "Solís",
  },
  {
    firstName: "Paula",
    paternalSurname: "Beltrán",
    maternalSurname: "Orellana",
  },
  { firstName: "Martín", paternalSurname: "Zamora", maternalSurname: "Téllez" },
  {
    firstName: "Julieta",
    paternalSurname: "Carrasco",
    maternalSurname: "Vidal",
  },
  {
    firstName: "Sebastián",
    paternalSurname: "Figueroa",
    maternalSurname: "Montes",
  },
  {
    firstName: "Gabriela",
    paternalSurname: "Roldán",
    maternalSurname: "Espinosa",
  },
  {
    firstName: "Joaquín",
    paternalSurname: "Olivares",
    maternalSurname: "Céspedes",
  },
  { firstName: "Natalia", paternalSurname: "Varela", maternalSurname: "Durán" },
  {
    firstName: "Esteban",
    paternalSurname: "Benavides",
    maternalSurname: "Roa",
  },
  {
    firstName: "Mariana",
    paternalSurname: "Santillán",
    maternalSurname: "Núñez",
  },
  {
    firstName: "Ricardo",
    paternalSurname: "Palacios",
    maternalSurname: "Ugarte",
  },
  { firstName: "Isabel", paternalSurname: "Morales", maternalSurname: "Luján" },
  {
    firstName: "Tomás",
    paternalSurname: "Bustos",
    maternalSurname: "Gallardo",
  },
  { firstName: "Clara", paternalSurname: "Rivas", maternalSurname: "Toledo" },
  { firstName: "Renato", paternalSurname: "Pereyra", maternalSurname: "Lagos" },
  {
    firstName: "Adriana",
    paternalSurname: "Cabrera",
    maternalSurname: "Alvarado",
  },
  {
    firstName: "Gabriel",
    paternalSurname: "Herrera",
    maternalSurname: "Valdés",
  },
  {
    firstName: "Victoria",
    paternalSurname: "Montalvo",
    maternalSurname: "Ponce",
  },
  {
    firstName: "Nicolás",
    paternalSurname: "Aguilar",
    maternalSurname: "Treviño",
  },
  {
    firstName: "Catalina",
    paternalSurname: "Navarro",
    maternalSurname: "Salcedo",
  },
  {
    firstName: "Emilio",
    paternalSurname: "Serrano",
    maternalSurname: "Castro",
  },
  {
    firstName: "Teresa",
    paternalSurname: "Vargas",
    maternalSurname: "Pizarro",
  },
  {
    firstName: "Pablo",
    paternalSurname: "Delgado",
    maternalSurname: "Cifuentes",
  },
  { firstName: "Lorena", paternalSurname: "Medina", maternalSurname: "Suárez" },
  {
    firstName: "Fernando",
    paternalSurname: "Paredes",
    maternalSurname: "Castañeda",
  },
  {
    firstName: "Beatriz",
    paternalSurname: "Torres",
    maternalSurname: "Miranda",
  },
  { firstName: "Hugo", paternalSurname: "Flores", maternalSurname: "Mendoza" },
  {
    firstName: "Valentina",
    paternalSurname: "Guzmán",
    maternalSurname: "Campos",
  },
  { firstName: "Álvaro", paternalSurname: "Rojas", maternalSurname: "Montero" },
  { firstName: "Andrea", paternalSurname: "Vidal", maternalSurname: "Ramírez" },
  {
    firstName: "Mauricio",
    paternalSurname: "Vega",
    maternalSurname: "Condori",
  },
  {
    firstName: "Carolina",
    paternalSurname: "Romero",
    maternalSurname: "Arias",
  },
] as const;

export const FULL_VALIDATION_AUTHORITIES = {
  departmentHead: "Lic. Hernan Ustariz Vargas",
  director: "MSc. Ing. Javier Caballero Flores",
  dean: "Mgr. Ing. Julio Marcelo Torrejón Rocabado",
} as const;

function publicSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

export function fullValidationSeedMatrix(
  anchorDay: string,
  consecutiveAbsenceLimit: number,
  minimumPaymentPercent: number,
) {
  validateAnchor(anchorDay);
  const source = validationCalendarPlan(
    anchorDay,
    consecutiveAbsenceLimit,
    minimumPaymentPercent,
  );
  const identities = new Map<
    string,
    (typeof FULL_VALIDATION_STUDENT_IDENTITIES)[number]
  >();
  let identityIndex = 0;
  const courses = source.samples.map((sample) => ({
    key: sample.key,
    name: sample.course.name,
    slug: publicSlug(sample.course.name),
    status: sample.course.status,
    startsAt: sample.course.startsAt.toISOString(),
    endsAt: sample.course.endsAt.toISOString(),
    registrationStartsAt: sample.course.registrationStartAt.toISOString(),
    registrationEndsAt: sample.course.registrationEndAt.toISOString(),
    instructorIndex: sample.teacher,
    groups: sample.groups.map((group, index) => ({
      ordinal: index + 1,
      capacity: group.capacity,
      status: group.status,
      startsAt: group.startsAt.toISOString(),
      endsAt: group.endsAt.toISOString(),
    })),
    components: sample.components.map(({ name, type, weight }, index) => ({
      name,
      type,
      weight,
      order: index + 1,
    })),
    registrations: sample.registrations.map((registration) => {
      // Shared CI retains the SAME three explicit fields across course enrolments.
      let identity = identities.get(registration.participant.ci);
      if (!identity) {
        identity = FULL_VALIDATION_STUDENT_IDENTITIES[identityIndex++];
        if (!identity)
          throw new Error("Reviewed student identity matrix exhausted");
        identities.set(registration.participant.ci, identity);
      }
      return {
        key: registration.key,
        scenario: registration.scenario,
        participant: {
          ...identity,
          ci: `${8700000 + FULL_VALIDATION_STUDENT_IDENTITIES.indexOf(identity) + 1}LP`,
          email: `${publicSlug(identity.firstName)}.${publicSlug(identity.paternalSurname)}@example.test`,
          phone: registration.participant.phone,
        },
      };
    }),
  }));
  const slugs = new Set(courses.map((course) => course.slug));
  if (slugs.size !== courses.length)
    throw new Error("Ambiguous public course slug");
  for (const course of courses) {
    if (/demo|fictici|ejemplo/iu.test(`${course.name} ${course.slug}`))
      throw new Error("Validation data must use natural display labels");
  }
  return {
    owner: FULL_VALIDATION_OWNER,
    mode: "MATRIX_ONLY_NO_WRITES",
    anchorDay,
    settings: { consecutiveAbsenceLimit, minimumPaymentPercent },
    authorities: FULL_VALIDATION_AUTHORITIES,
    formats: source.formats.map(
      ({
        name,
        active,
        totalHours,
        sessionMinutes,
        studentAmount,
        externalAmount,
      }) => ({
        name,
        active,
        totalHours,
        sessionMinutes,
        studentAmount,
        externalAmount,
      }),
    ),
    courses,
    studentIdentityCount: identities.size,
    certificateContract:
      "Current-record v2 service: one group/type/recipient, atomic signed upload and current-file hash",
    additionalAccountCases: [
      "Retained authenticated primary ADMIN with natural display name",
      "Authorized active/invited/disabled ADMIN cases via actual account services",
      "Active instructor with no assigned course",
      "Instructor denied ADMIN routes and other instructors' course records",
    ],
    additionalWorkflowCases: [
      "Active/cancelled/converted interest and duplicate normalization",
      "Ordinary/auxiliary/free pricing, partial/full payment, cancellation/refund/transfer",
      "Pass/fail/zero/boundary/pending grades and N/N+1 attendance",
      "Cancelled/replacement sessions and historical review",
      "Natural current official closures and legitimate reopen/reclose",
      "One current v2 certificate per eligible recipient with unsigned/signed-current variants",
    ],
    limitations: [
      "Planning only; no participant/course/registration/closure/certificate inserted",
      "Exact integrated schema and separate stage PLAN hashes are required before APPLY",
    ],
  };
}

export function currentFullValidationAnchor(): string {
  return currentAnchor();
}

/** Feed established real finance/attendance/grade/closure fixture services with
 * the explicitly reviewed three-part identities and natural public slugs. */
export function fullValidationBusinessPlan(
  anchorDay: string,
  consecutiveAbsenceLimit: number,
  minimumPaymentPercent: number,
): ComprehensiveDemoPlan {
  const source = validationCalendarPlan(
    anchorDay,
    consecutiveAbsenceLimit,
    minimumPaymentPercent,
  );
  const matrix = fullValidationSeedMatrix(
    anchorDay,
    consecutiveAbsenceLimit,
    minimumPaymentPercent,
  );
  for (const sample of source.samples) {
    const planned = matrix.courses.find((course) => course.key === sample.key);
    if (!planned)
      throw new Error("Reviewed course missing from validation matrix");
    sample.course.slug = planned.slug;
    for (const registration of sample.registrations) {
      const expected = planned.registrations.find(
        (r) => r.key === registration.key,
      );
      if (!expected)
        throw new Error("Reviewed registration missing from validation matrix");
      registration.participant = { ...expected.participant };
    }
  }
  return source;
}

const program: Readonly<Record<string, readonly string[]>> = {
  closed: [
    "Organización de hojas y referencias",
    "Funciones, filtros y tablas dinámicas",
    "Reportes para decisiones administrativas",
  ],
  reclosed: [
    "Preparación y limpieza de datos",
    "Análisis con pandas y visualización",
    "Comunicación de resultados reproducibles",
  ],
  pending: [
    "Jerarquía visual y navegación",
    "Contraste, etiquetas y teclado",
    "Prototipado y evaluación de accesibilidad",
  ],
  current: [
    "Escucha activa y acuerdos de equipo",
    "Retroalimentación y resolución de conflictos",
    "Presentaciones breves y coordinación de tareas",
  ],
  future: [
    "Objetivos, alcance y cronograma",
    "Asignación de responsabilidades",
    "Seguimiento de riesgos y entregables",
  ],
  free: [
    "Estructura semántica con HTML",
    "Estilos responsivos con CSS",
    "Interacción básica con JavaScript",
  ],
  draft: [
    "Protección de cuentas y dispositivos",
    "Copias de seguridad y control de acceso",
    "Respuesta organizada ante incidentes",
  ],
  archived: [
    "Organización documental y colaboración",
    "Hojas de cálculo para el trabajo diario",
    "Automatización de tareas repetitivas",
  ],
  "next-open-data": [
    "Selección de indicadores y fuentes",
    "Gráficos y paneles comprensibles",
    "Narración visual para decisiones",
  ],
  "next-open-web": [
    "Funciones y estructuras de datos",
    "Eventos y componentes de interfaz",
    "Consumo de servicios y manejo de errores",
  ],
  "next-upcoming-projects": [
    "Diagnóstico y objetivos comunitarios",
    "Presupuesto, calendario y alianzas",
    "Evaluación de resultados e impacto",
  ],
  "next-upcoming-security": [
    "Inventario y clasificación de información",
    "Permisos, respaldos y buenas prácticas",
    "Continuidad y recuperación del trabajo",
  ],
};

/** The normal calendar planner recomputes dates/intervals, rather than printing
 * hours that disagree with the actual sessions. No old cohort is moved: this
 * function is exclusively for the freshly reset validation dataset. */
function validationCalendarPlan(
  anchorDay: string,
  limit: number,
  minimumPaymentPercent: number,
): ComprehensiveDemoPlan {
  const source = comprehensiveDemoPlan(anchorDay, limit, minimumPaymentPercent);
  const labels = [
    "Taller de formación aplicada",
    "Laboratorio abierto",
    "Seminario de herramientas digitales",
    "Clínica de proyectos",
  ];
  source.formats.forEach((format, index) => {
    format.totalHours =
      index === 1 || index === 3
        ? Math.max(30, limit + 2)
        : Math.max(20, limit + 2);
    format.sessionMinutes = 60;
    format.name = `${labels[index]} · ${format.totalHours} horas`;
  });
  const pastOffsets: Readonly<Record<string, number>> = {
    closed: -90,
    reclosed: -60,
    pending: -35,
    archived: -120,
  };
  for (const sample of source.samples) {
    // Keep the fourth retained active instructor genuinely unassigned. The
    // three former index-3 cohorts occupy non-overlapping calendar periods.
    if (sample.teacher === 3) sample.teacher = 0;
    const format = source.formats.find(
      (f) =>
        comprehensiveDemoId(`revision:${f.id}`) ===
        sample.course.courseTypeRevisionId,
    );
    if (!format)
      throw new Error("Reviewed format missing for validation calendar");
    let start =
      pastOffsets[sample.key] === undefined
        ? instantToBoliviaCivil(sample.course.startsAt).slice(0, 10)
        : shiftedDay(anchorDay, pastOffsets[sample.key]!);
    while ([0, 6].includes(new Date(`${start}T00:00:00Z`).getUTCDay()))
      start = shiftedDay(start, 1);
    const dates = planCourseDates({
      startDate: start,
      weekdaysMask: 31,
      totalHours: format.totalHours,
      sessionMinutes: format.sessionMinutes,
    });
    Object.assign(sample.course, dates);
    sample.course.registrationEndAt = boliviaCivilToInstant(
      `${shiftedDay(start, -1)}T00:00`,
    );
    if (!sample.key.startsWith("next-")) {
      sample.course.registrationStartAt = boliviaCivilToInstant(
        `${shiftedDay(start < anchorDay ? start : anchorDay, -14)}T00:00`,
      );
      sample.fixtureClock =
        start < anchorDay
          ? boliviaCivilToInstant(`${shiftedDay(start, -2)}T12:00`)
          : source.now;
    }
    for (const group of sample.groups) {
      const time = instantToBoliviaCivil(group.startsAt).slice(11);
      Object.assign(
        group,
        groupPlan({ ...dates, weekdaysMask: 31 }, format, time),
      );
    }
    const modules = program[sample.key];
    if (!modules)
      throw new Error("Course program missing from reviewed validation matrix");
    sample.course.contentMarkdown = `## Programa\n\n${modules.map((module) => `- ${module}`).join("\n")}\n\n## Aplicación\n\nTrabajo guiado y una entrega final relacionada con el curso.`;
  }
  return source;
}
