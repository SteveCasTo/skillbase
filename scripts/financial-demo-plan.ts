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
import { assertCanonicalLocalTarget } from "./renew-demo-plan";

export const FINANCIAL_DEMO_OWNER = "skillbase-financial-demo-v1";
export const PRODUCTION_PROJECT = "fvzxqlezdrlzykyoevub";
export function financialDemoId(key: string): string {
  const h = createHash("sha256")
    .update(`${FINANCIAL_DEMO_OWNER}:${key}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function shiftedDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function validateAnchor(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) throw new Error("Invalid anchor day");
  boliviaCivilToInstant(`${day}T00:00`);
  return day;
}
export function currentAnchor(now = new Date()): string {
  return instantToBoliviaCivil(now).slice(0, 10);
}
export function assertFinancialTarget(
  target: string,
  databaseUrl: string,
  apiUrl: string,
  project: string,
): void {
  if (target === "local") {
    if (project !== "local") throw new Error("Explicit local project required");
    assertCanonicalLocalTarget(databaseUrl, apiUrl);
    return;
  }
  try {
    const db = new URL(databaseUrl);
    const api = new URL(apiUrl);
    const direct =
      db.hostname === `db.${PRODUCTION_PROJECT}.supabase.co` &&
      db.username === "postgres" &&
      db.port === "5432";
    const pooler =
      /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(db.hostname) &&
      db.username === `postgres.${PRODUCTION_PROJECT}` &&
      ["5432", "6543"].includes(db.port);
    if (
      target !== "production" ||
      project !== PRODUCTION_PROJECT ||
      !["postgres:", "postgresql:"].includes(db.protocol) ||
      (!direct && !pooler) ||
      db.pathname !== "/postgres" ||
      db.hash ||
      (db.search && db.search !== "?sslmode=require") ||
      api.href !== `https://${PRODUCTION_PROJECT}.supabase.co/`
    )
      throw new Error();
  } catch {
    throw new Error("Financial demo target identity refused");
  }
}
export const financialFormats = [false, true].map((free) => ({
  id: financialDemoId(`format:${free ? "free" : "paid"}`),
  name: free ? "Taller abierto · 20 horas" : "Taller práctico · 20 horas",
  totalHours: 20,
  sessionMinutes: 90,
  studentAmount: free ? "0.00" : "80.00",
  externalAmount: free ? "0.00" : "100.00",
}));
export function financialDemoPlan(
  anchorDay: string,
  minimumPaymentPercent: number,
) {
  validateAnchor(anchorDay);
  if (
    !Number.isInteger(minimumPaymentPercent) ||
    minimumPaymentPercent < 1 ||
    minimumPaymentPercent >= 100
  )
    throw new Error(
      "A partial-payment demo requires minimum payment below 100%; settings will not be changed",
    );
  const definitions = [
    {
      key: "past",
      name: "Herramientas digitales aplicadas",
      offset: -35,
      teacher: 0,
      free: false,
    },
    {
      key: "current",
      name: "Comunicación y trabajo colaborativo",
      offset: 0,
      teacher: 1,
      free: false,
    },
    {
      key: "future",
      name: "Organización de proyectos prácticos",
      offset: 28,
      teacher: 2,
      free: false,
    },
    {
      key: "free",
      name: "Introducción abierta a recursos digitales",
      offset: 60,
      teacher: 0,
      free: true,
    },
  ];
  const samples = definitions.map((def) => {
    let startDate = shiftedDay(anchorDay, def.offset);
    while ([0, 6].includes(new Date(`${startDate}T00:00:00Z`).getUTCDay()))
      startDate = shiftedDay(startDate, def.key === "current" ? -1 : 1);
    const format = financialFormats[def.free ? 1 : 0]!;
    const dates = planCourseDates({ startDate, weekdaysMask: 31, ...format });
    const fixtureClock = new Date(
      Math.min(
        boliviaCivilToInstant(`${shiftedDay(startDate, -8)}T10:00`).getTime(),
        boliviaCivilToInstant(`${anchorDay}T00:00`).getTime(),
      ),
    );
    const course = {
      id: financialDemoId(`course:${def.key}`),
      slug: `demo-finanzas-v1-${def.key}`,
      name: def.name,
      description:
        "Curso de demostración con participantes y movimientos de efectivo ficticios.",
      conditions:
        "Datos sintéticos de demostración; no representa una oferta comercial real.",
      contentMarkdown:
        "## Programa\n\n- Fundamentos\n- Ejercicios guiados\n- Proyecto práctico",
      level: "BASIC" as const,
      minimumGrade: 70,
      schedule: GROUP_SCHEDULE,
      weekdaysMask: 31,
      startsAt: dates.startsAt,
      endsAt: dates.endsAt,
      registrationStartAt: boliviaCivilToInstant(
        `${shiftedDay(startDate < anchorDay ? startDate : anchorDay, -14)}T00:00`,
      ),
      registrationEndAt: boliviaCivilToInstant(
        `${shiftedDay(startDate, -1)}T23:59`,
      ),
      status: "PUBLISHED" as const,
      featured: false,
      courseTypeRevisionId: financialDemoId(`revision:${format.id}`),
    };
    const groups = ["12:00", "14:00"].map((time, i) => ({
      id: financialDemoId(`group:${def.key}:${i}`),
      courseId: course.id,
      courseTypeRevisionId: course.courseTypeRevisionId,
      capacity: 20,
      publishedAt: fixtureClock,
      ...groupPlan({ ...dates, weekdaysMask: 31 }, format, time),
    }));
    const scenarios = def.free
      ? ["free"]
      : def.key === "future"
        ? ["paid", "partial", "owed", "refunded", "transfer", "completed"]
        : ["paid", "partial"];
    const registrations = scenarios.map((scenario, i) => ({
      key: `${def.key}:${scenario}`,
      scenario,
      participant: {
        ci: `00FD${definitions.indexOf(def) + 1}${String(i + 1).padStart(3, "0")}LP`,
        firstName: ["Lucía", "Mateo", "Elena", "Diego", "Sofía", "Andrés"][i]!,
        lastName: "Ejemplo",
        email: `finanzas.v1.${def.key}.${scenario}@example.test`,
        phone: null,
      },
      amountCents: def.free
        ? 0
        : ["partial", "completed"].includes(scenario)
          ? Math.max(1, Math.ceil((8000 * minimumPaymentPercent) / 100))
          : 8000,
    }));
    return {
      key: def.key,
      teacher: def.teacher,
      course,
      groups,
      fixtureClock,
      registrations,
    };
  });
  return {
    owner: FINANCIAL_DEMO_OWNER,
    anchorDay,
    minimumPaymentPercent,
    formats: financialFormats,
    samples,
  };
}
export type FinancialDemoPlan = ReturnType<typeof financialDemoPlan>;
/** Stable course/group IDs and resolved registration IDs are reusable by a later, separate attendance seed. */
export interface FinancialDemoContext {
  readonly owner: string;
  readonly anchorDay: string;
  readonly registrations: Readonly<Record<string, string>>;
  readonly courses: Readonly<
    Record<string, { courseId: string; groupIds: readonly string[] }>
  >;
}
