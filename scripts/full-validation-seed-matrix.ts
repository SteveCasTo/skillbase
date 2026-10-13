import { comprehensiveDemoPlan } from "./comprehensive-demo-plan";
import { currentAnchor, validateAnchor } from "./financial-demo-plan";
import type { ComprehensiveDemoPlan } from "./comprehensive-demo-plan";

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
  const source = comprehensiveDemoPlan(
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
      "Await approved current-record service from certificate owner",
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
      "Reviewed service mapping and exact integrated schema are required before APPLY",
      "New certificate enum/commands must not be guessed from legacy fixtures",
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
  const source = comprehensiveDemoPlan(
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
