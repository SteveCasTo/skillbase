import { createDatabase } from "@/server/db/client";
import {
  courseTypeRevisions,
  courseTypes,
  courses,
  groups,
} from "@/server/db/schema";
import {
  boliviaCivilToInstant,
  instantToBoliviaCivil,
} from "@/domain/courses/bolivia-time";
import {
  GROUP_SCHEDULE,
  planCourseDates,
} from "@/domain/courses/weekday-schedule";
import { groupPlan, overlaps } from "@/domain/groups/rules";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { getLocalSupabaseEnvironment } from "./supabase-local-env";

const DAY_MS = 86400000;
const samples = [
  {
    slug: "demo-programacion-web",
    name: "Programación web desde cero",
    description:
      "Aprende a construir sitios accesibles con HTML, CSS y JavaScript.",
    level: "BASIC",
    format: "Formato 20 horas",
    conditions: "No se requieren conocimientos previos.",
    contentMarkdown:
      "## Lo que aprenderás\n\nEstructura web, estilos y primeros pasos con JavaScript.",
    startOffset: 40,
    registrationOffset: -7,
    status: "PUBLISHED",
    featured: true,
    groups: [
      { startTime: "09:00", capacity: 20 },
      { startTime: "18:00", capacity: 15 },
    ],
  },
  {
    slug: "demo-analisis-de-datos",
    name: "Análisis de datos aplicado",
    description:
      "Explora conjuntos de datos y comunica hallazgos con claridad.",
    level: "INTERMEDIATE",
    format: "Formato 30 horas",
    conditions: "Se recomienda familiaridad con hojas de cálculo.",
    contentMarkdown: null,
    startOffset: 55,
    registrationOffset: 5,
    status: "PUBLISHED",
    featured: false,
    groups: [{ startTime: "09:00", capacity: 25 }],
  },
  {
    slug: "demo-diseno-de-interfaces",
    name: "Diseño de interfaces digitales",
    description: "Practica fundamentos de diseño centrado en las personas.",
    level: "BASIC",
    format: "Formato 20 horas",
    conditions: "Abierto a participantes de cualquier especialidad.",
    contentMarkdown: null,
    startOffset: 65,
    registrationOffset: -3,
    status: "PUBLISHED",
    featured: false,
    groups: [{ startTime: "14:00", capacity: 18 }],
  },
  {
    slug: "demo-ciberseguridad-basica",
    name: "Fundamentos de ciberseguridad",
    description:
      "Reconoce riesgos frecuentes y buenas prácticas de protección.",
    level: "BASIC",
    format: "Formato 30 horas",
    conditions: "Solo necesitas experiencia básica usando computadoras.",
    contentMarkdown: null,
    startOffset: 75,
    registrationOffset: 10,
    status: "PUBLISHED",
    featured: false,
    groups: [{ startTime: "18:00", capacity: 22 }],
  },
  {
    slug: "demo-gestion-de-proyectos",
    name: "Gestión de proyectos colaborativos",
    description:
      "Planifica actividades y coordina equipos mediante casos prácticos.",
    level: "INTERMEDIATE",
    format: "Formato 30 horas",
    conditions: "No se requieren herramientas de pago.",
    contentMarkdown: null,
    startOffset: 90,
    registrationOffset: null,
    status: "DRAFT",
    featured: false,
    groups: [{ startTime: "09:00", capacity: 16 }],
  },
] as const;

type Revision = {
  revisionId: string;
  totalHours: number;
  sessionMinutes: number | null;
};

function civilDateAtOffset(today: string, offset: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function nextWeekday(date: string): string {
  let result = date;
  while ([0, 6].includes(new Date(`${result}T00:00:00Z`).getUTCDay())) {
    result = civilDateAtOffset(result, 1);
  }
  return result;
}

/** Only plan missing slugs: rerunning the seed never rewrites an edited demo or adds groups to it. */
export function planDemoCourses(
  now: Date,
  revisions: ReadonlyMap<string, Revision>,
  existingSlugs: ReadonlySet<string> = new Set(),
) {
  const today = instantToBoliviaCivil(now).slice(0, 10);
  return samples
    .filter((sample) => !existingSlugs.has(sample.slug))
    .map((sample) => {
      const revision = revisions.get(sample.format);
      if (!revision || revision.sessionMinutes === null)
        throw new Error(`Seed format needs session minutes: ${sample.format}`);
      const startDate = nextWeekday(
        civilDateAtOffset(today, sample.startOffset),
      );
      const dates = planCourseDates({
        startDate,
        weekdaysMask: 31,
        totalHours: revision.totalHours,
        sessionMinutes: revision.sessionMinutes,
      });
      const registrationStartAt =
        sample.registrationOffset === null
          ? null
          : boliviaCivilToInstant(
              `${civilDateAtOffset(today, sample.registrationOffset)}T00:00`,
            );
      // Exclusive boundary at midnight: the last registration day is seven days before classes.
      const registrationEndAt =
        sample.registrationOffset === null
          ? null
          : boliviaCivilToInstant(`${civilDateAtOffset(startDate, -6)}T00:00`);
      if (
        registrationStartAt &&
        registrationEndAt &&
        !(
          registrationStartAt < registrationEndAt &&
          registrationEndAt < dates.startsAt
        )
      )
        throw new Error(`Invalid demo registration window: ${sample.slug}`);

      const plannedGroups = sample.groups.map(({ startTime, capacity }) => ({
        capacity,
        ...groupPlan({ ...dates, weekdaysMask: 31 }, revision, startTime),
      }));
      if (
        plannedGroups.some((group, index) =>
          plannedGroups
            .slice(index + 1)
            .some((other) =>
              overlaps(
                group.startsAt,
                group.endsAt,
                other.startsAt,
                other.endsAt,
              ),
            ),
        )
      )
        throw new Error(`Overlapping demo groups: ${sample.slug}`);

      return {
        course: {
          slug: sample.slug,
          name: sample.name,
          description: sample.description,
          level: sample.level,
          schedule: GROUP_SCHEDULE,
          weekdaysMask: 31,
          conditions: sample.conditions,
          contentMarkdown: sample.contentMarkdown,
          startsAt: dates.startsAt,
          endsAt: dates.endsAt,
          registrationStartAt,
          registrationEndAt,
          status: sample.status,
          featured: sample.featured,
          courseTypeRevisionId: revision.revisionId,
          minimumGrade: 70,
          instructorName: "Equipo docente de ejemplo",
        },
        groups: plannedGroups,
      };
    });
}

if (import.meta.main) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required in .env.");
  const configured = new URL(connectionString);
  const local = new URL(getLocalSupabaseEnvironment().databaseUrl);
  if (
    configured.hostname !== local.hostname ||
    configured.port !== local.port ||
    configured.pathname !== local.pathname ||
    configured.username !== local.username
  )
    throw new Error(
      "db:seed:demo only accepts the running local Supabase database.",
    );

  // Development formats only; never reset or migrate existing local data.
  await import("./seed");
  const database = createDatabase(connectionString);
  try {
    const created = await database.db.transaction(async (tx) => {
      // Match the course repository's lock order for concurrent format/slug changes.
      await tx.execute(sql`select pg_advisory_xact_lock(20260915, 3)`);
      await tx.execute(sql`select pg_advisory_xact_lock(20260915, 1)`);
      const formats = await tx
        .select({
          name: courseTypes.name,
          revisionId: courseTypeRevisions.id,
          totalHours: courseTypeRevisions.totalHours,
          sessionMinutes: courseTypeRevisions.sessionMinutes,
        })
        .from(courseTypes)
        .innerJoin(
          courseTypeRevisions,
          eq(courseTypeRevisions.courseTypeId, courseTypes.id),
        )
        .where(
          inArray(courseTypes.name, ["Formato 20 horas", "Formato 30 horas"]),
        )
        .orderBy(desc(courseTypeRevisions.revisionNumber));
      const revisions = new Map<string, Revision>();
      for (const format of formats) {
        if (!revisions.has(format.name)) revisions.set(format.name, format);
      }
      const existing = await tx
        .select({ slug: courses.slug })
        .from(courses)
        .where(
          inArray(
            courses.slug,
            samples.map((sample) => sample.slug),
          ),
        );
      const planned = planDemoCourses(
        new Date(),
        revisions,
        new Set(existing.map(({ slug }) => slug)),
      );
      const [featured] = await tx
        .select({ id: courses.id })
        .from(courses)
        .where(
          sql`${courses.status} = 'PUBLISHED' and ${courses.featured} = true`,
        )
        .limit(1);
      let hasFeatured = Boolean(featured);
      for (const { course, groups: plannedGroups } of planned) {
        const isFeatured = course.featured && !hasFeatured;
        const [inserted] = await tx
          .insert(courses)
          .values({ ...course, featured: isFeatured })
          .returning({ id: courses.id });
        if (!inserted) throw new Error("Demo course insert failed");
        hasFeatured ||= isFeatured;
        await tx.insert(groups).values(
          plannedGroups.map((group) => ({
            courseId: inserted.id,
            courseTypeRevisionId: course.courseTypeRevisionId,
            capacity: group.capacity,
            startsAt: group.startsAt,
            endsAt: group.endsAt,
          })),
        );
      }
      return planned.length;
    });
    console.info(
      `Demo courses: ${created} created, ${samples.length - created} already present.`,
    );
  } finally {
    await database.close();
  }
}
