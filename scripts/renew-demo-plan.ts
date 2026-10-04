import { createHash } from "node:crypto";
import {
  boliviaCivilToInstant,
  instantToBoliviaCivil,
} from "@/domain/courses/bolivia-time";
import {
  GROUP_SCHEDULE,
  planCourseDates,
} from "@/domain/courses/weekday-schedule";
import { groupPlan } from "@/domain/groups/rules";

export const SEED_OWNER = "skillbase-instructor-interest-demo-v1";
export const RESET_TABLES = [
  "interest_registrations",
  "interest_registration_rate_limits",
  "course_instructor_history",
  "audit_events",
  "groups",
  "courses",
  "course_type_revisions",
  "course_types",
] as const;
export function seedId(key: string): string {
  const hex = createHash("sha256").update(`${SEED_OWNER}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export const teachers = [
  {
    firstName: "Ada",
    lastName: "Ejemplo",
    email: "demo.ada@example.test",
    phone: null,
  },
  {
    firstName: "Bruno",
    lastName: "Sintético",
    email: "demo.bruno@example.test",
    phone: "70000002",
  },
  {
    firstName: "Clara",
    lastName: "Demostración",
    email: "demo.clara@example.test",
    phone: null,
  },
] as const;
export const formats = [
  {
    id: seedId("format:20"),
    name: "Demo · 20 horas",
    totalHours: 20,
    sessionMinutes: 90,
    studentAmount: "80.00",
    externalAmount: "100.00",
  },
  {
    id: seedId("format:30"),
    name: "Demo · 30 horas",
    totalHours: 30,
    sessionMinutes: 150,
    studentAmount: "120.00",
    externalAmount: "150.00",
  },
] as const;
const samples = [
  {
    slug: "demo-web",
    name: "Programación web desde cero",
    teacher: 0,
    format: 0,
    offset: 40,
    window: "OPEN",
    distribution: [8, 2, 1],
    cancelled: 2,
  },
  {
    slug: "demo-datos",
    name: "Análisis de datos aplicado",
    teacher: 1,
    format: 1,
    offset: 40,
    window: "OPEN",
    distribution: [1, 1, 8],
    cancelled: 1,
  },
  {
    slug: "demo-diseno",
    name: "Diseño de interfaces digitales",
    teacher: 2,
    format: 0,
    offset: 40,
    window: "OPEN",
    distribution: [3, 3, 3],
    cancelled: 2,
  },
  {
    slug: "demo-seguridad",
    name: "Fundamentos de ciberseguridad",
    teacher: 0,
    format: 1,
    offset: 100,
    window: "OPEN",
    distribution: [0, 0, 0],
    cancelled: 0,
  },
  {
    slug: "demo-proyectos",
    name: "Gestión de proyectos colaborativos",
    teacher: 1,
    format: 1,
    offset: 100,
    window: "UPCOMING",
    distribution: [0, 0, 0],
    cancelled: 0,
  },
  {
    slug: "demo-borrador",
    name: "Automatización práctica · borrador",
    teacher: 2,
    format: 0,
    offset: 100,
    window: "NONE",
    distribution: [0, 0, 0],
    cancelled: 0,
  },
] as const;
function day(today: string, offset: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function renewalPlan(now: Date) {
  const today = instantToBoliviaCivil(now).slice(0, 10);
  return samples.map((sample, index) => {
    const format = formats[sample.format]!;
    let startDate = day(today, sample.offset);
    while ([0, 6].includes(new Date(`${startDate}T00:00:00Z`).getUTCDay()))
      startDate = day(startDate, 1);
    const dates = planCourseDates({ startDate, weekdaysMask: 31, ...format });
    const status =
      sample.window === "NONE" ? ("DRAFT" as const) : ("PUBLISHED" as const);
    const course = {
      id: seedId(sample.slug),
      slug: sample.slug,
      name: sample.name,
      description:
        "Curso ficticio para explorar la oferta y la gestión de interesados.",
      conditions:
        "Datos sintéticos de desarrollo; no representa una oferta real.",
      contentMarkdown:
        "## Contenido de ejemplo\n\n- Fundamentos\n- Práctica guiada\n- Proyecto final",
      level: "BASIC" as const,
      minimumGrade: 70,
      schedule: GROUP_SCHEDULE,
      weekdaysMask: 31,
      ...dates,
      registrationStartAt:
        sample.window === "NONE"
          ? null
          : boliviaCivilToInstant(
              `${day(today, sample.window === "OPEN" ? -7 : 7)}T00:00`,
            ),
      registrationEndAt:
        sample.window === "NONE"
          ? null
          : boliviaCivilToInstant(`${day(startDate, -7)}T00:00`),
      status,
      featured: index === 0,
      courseTypeRevisionId: seedId(`revision:${format.id}`),
    };
    const groups = ["09:00", "18:00"].map((time, groupIndex) => ({
      id: seedId(`${sample.slug}:group:${groupIndex}`),
      courseId: course.id,
      courseTypeRevisionId: course.courseTypeRevisionId,
      capacity: groupIndex === 0 ? 20 : 15,
      publishedAt: status === "PUBLISHED" ? now : null,
      ...groupPlan({ ...dates, weekdaysMask: 31 }, format, time),
    }));
    let serial = 0;
    const interests = sample.distribution.flatMap((count, bucket) =>
      Array.from({ length: count }, () => {
        const n = serial++;
        return {
          id: seedId(`${sample.slug}:interest:${n}`),
          courseId: course.id,
          firstName: `Persona ${n + 1}`,
          lastName: "Ejemplo sintético",
          email: `${sample.slug}.${n + 1}@example.test`,
          phone: n % 2 ? null : "70000000",
          preferredGroupId: bucket === 2 ? null : groups[bucket]!.id,
          status: "ACTIVE" as const,
          createdAt: new Date(now.getTime() - (60 - n) * 60000),
          updatedAt: now,
        };
      }),
    );
    const cancelled = Array.from({ length: sample.cancelled }, (_, n) => ({
      id: seedId(`${sample.slug}:cancelled:${n}`),
      courseId: course.id,
      firstName: `Persona cancelada ${n + 1}`,
      lastName: "Ejemplo sintético",
      email: `${sample.slug}.cancelled.${n + 1}@example.test`,
      phone: null,
      preferredGroupId: n % 2 ? null : groups[0]!.id,
      status: "CANCELLED" as const,
      createdAt: new Date(now.getTime() - 86400000),
      updatedAt: now,
    }));
    return {
      teacher: sample.teacher,
      course,
      groups,
      interests: [...interests, ...cancelled],
    };
  });
}

/** Called before CLI discovery, client creation, or any network access. No URL values in errors. */
export function assertCanonicalLocalTarget(
  databaseUrl: string,
  apiUrl: string,
): void {
  try {
    const db = new URL(databaseUrl);
    const api = new URL(apiUrl);
    if (
      !["postgres:", "postgresql:"].includes(db.protocol) ||
      db.hostname !== "127.0.0.1" ||
      db.port !== "55322" ||
      db.pathname !== "/postgres" ||
      db.username !== "postgres" ||
      db.search ||
      db.hash ||
      api.href !== "http://127.0.0.1:55321/"
    )
      throw new Error();
  } catch {
    throw new Error(
      "Renewal only accepts canonical local Supabase (127.0.0.1:55322 / 55321).",
    );
  }
}
