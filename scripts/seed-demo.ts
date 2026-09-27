import { createDatabase } from "@/server/db/client";
import { courseTypeRevisions, courseTypes, courses } from "@/server/db/schema";
import { getLocalSupabaseEnvironment } from "./supabase-local-env";
import { and, desc, eq, inArray } from "drizzle-orm";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import { planWeekdaySchedule } from "@/domain/courses/weekday-schedule";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required in .env.");

const configured = new URL(connectionString);
const local = new URL(getLocalSupabaseEnvironment().databaseUrl);
if (
  configured.hostname !== local.hostname ||
  configured.port !== local.port ||
  configured.pathname !== local.pathname ||
  configured.username !== local.username
) {
  throw new Error(
    "db:seed:demo only accepts the running local Supabase database.",
  );
}

// Reuse the agreed 20 h / 30 h formats and optional admin invitation.
await import("./seed");

const day = 24 * 60 * 60 * 1000;
const now = Date.now();
const after = (days: number) => new Date(now + days * day);
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
    startsAt: after(40),
    registrationStartAt: after(-7),
    registrationEndAt: after(30),
    status: "PUBLISHED",
    featured: true,
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
    startsAt: after(55),
    registrationStartAt: after(5),
    registrationEndAt: after(45),
    status: "PUBLISHED",
    featured: false,
  },
  {
    slug: "demo-diseno-de-interfaces",
    name: "Diseño de interfaces digitales",
    description: "Practica fundamentos de diseño centrado en las personas.",
    level: "BASIC",
    format: "Formato 20 horas",
    conditions: "Abierto a participantes de cualquier especialidad.",
    contentMarkdown: null,
    startsAt: after(65),
    registrationStartAt: after(-3),
    registrationEndAt: after(50),
    status: "PUBLISHED",
    featured: false,
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
    startsAt: after(75),
    registrationStartAt: after(10),
    registrationEndAt: after(60),
    status: "PUBLISHED",
    featured: false,
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
    startsAt: after(90),
    registrationStartAt: null,
    registrationEndAt: null,
    status: "DRAFT",
    featured: false,
  },
] as const;

const database = createDatabase(connectionString);
try {
  const created = await database.db.transaction(async (tx) => {
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
    const revisions = new Map<string, (typeof formats)[number]>();
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
    const slugs = new Set(existing.map((course) => course.slug));
    const [featured] = await tx
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.status, "PUBLISHED"), eq(courses.featured, true)))
      .limit(1);

    let inserted = 0;
    for (const sample of samples) {
      if (slugs.has(sample.slug)) continue;
      const revision = revisions.get(sample.format);
      if (!revision?.sessionMinutes)
        throw new Error(`Seed format needs session minutes: ${sample.format}`);
      let start = instantToBoliviaCivil(sample.startsAt).slice(0, 10);
      // Start on the next weekday, at a stable Bolivia civil hour, regardless of the host timezone.
      while ([0, 6].includes(new Date(`${start}T00:00:00Z`).getUTCDay()))
        start = new Date(new Date(`${start}T00:00:00Z`).getTime() + day)
          .toISOString()
          .slice(0, 10);
      const startsAt = `${start}T18:00`;
      const plan = planWeekdaySchedule({
        startsAt,
        weekdaysMask: 31,
        totalHours: revision.totalHours,
        sessionMinutes: revision.sessionMinutes,
      });
      await tx.insert(courses).values({
        slug: sample.slug,
        name: sample.name,
        description: sample.description,
        level: sample.level,
        schedule: `Lunes a viernes, 18:00–${plan.endTime}`,
        weekdaysMask: 31,
        conditions: sample.conditions,
        contentMarkdown: sample.contentMarkdown,
        startsAt: plan.sessions[0]!.startsAt,
        endsAt: plan.endsAt,
        registrationStartAt: sample.registrationStartAt,
        registrationEndAt: sample.registrationEndAt,
        status: sample.status,
        courseTypeRevisionId: revision.revisionId,
        featured: sample.featured && !featured,
        minimumGrade: 70,
        instructorName: "Equipo docente de ejemplo",
      });
      inserted++;
    }
    return inserted;
  });
  console.info(
    `Demo courses: ${created} created, ${samples.length - created} already present.`,
  );
} finally {
  await database.close();
}
