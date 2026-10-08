import { createHash } from "node:crypto";
import { boliviaCivilToInstant } from "@/domain/courses/bolivia-time";
import {
  GROUP_SCHEDULE,
  planCourseDates,
} from "@/domain/courses/weekday-schedule";
import { groupPlan } from "@/domain/groups/rules";
import {
  shiftedDay,
  validateAnchor,
  assertFinancialTarget,
} from "./financial-demo-plan";
import { getTestSupabaseEnvironment } from "./supabase-local-env";

export const COMPREHENSIVE_DEMO_OWNER = "skillbase-comprehensive-demo-v1";
export function assertComprehensiveRelease(
  branch: string,
  head: string,
  status: string,
  approvedSha: string,
): void {
  if (
    branch.trim() !== "master" ||
    status.trim() ||
    !/^[a-f0-9]{40}$/u.test(approvedSha) ||
    head.trim() !== approvedSha
  )
    throw new Error(
      "Production requires the clean, operator-approved master release",
    );
}
/** Same deterministic hash-ID convention as the existing financial/attendance seeds. */
export function comprehensiveDemoId(key: string): string {
  const h = createHash("sha256")
    .update(`${COMPREHENSIVE_DEMO_OWNER}:${key}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function assertComprehensiveTarget(
  target: string,
  project: string,
  databaseUrl: string,
  apiUrl: string,
  allowProduction: boolean,
): void {
  if (target === "qa") {
    const owned = getTestSupabaseEnvironment();
    if (
      project !== process.env.TEST_SUPABASE_PROJECT_ID ||
      databaseUrl !== owned.databaseUrl ||
      apiUrl !== owned.apiUrl
    )
      throw new Error("Runner-owned QA target required");
    return;
  }
  assertFinancialTarget(target, databaseUrl, apiUrl, project);
  if (target === "production" && !allowProduction)
    throw new Error("Explicit production approval required");
}

export function parseComprehensiveArgs(args: readonly string[]) {
  const values = new Map<string, string>();
  const switches = new Set([
    "--apply",
    "--allow-production",
    "--protected-manual",
  ]);
  const allowed = new Set([...switches, "--target", "--project", "--anchor"]);
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (!allowed.has(key) || values.has(key))
      throw new Error("Invalid arguments");
    const value = switches.has(key) ? "true" : args[++i];
    if (!value || value.startsWith("--"))
      throw new Error("Argument value required");
    values.set(key, value);
  }
  if (!values.has("--target") || !values.has("--project"))
    throw new Error("Explicit target and project required");
  return {
    target: values.get("--target")!,
    project: values.get("--project")!,
    apply: values.has("--apply"),
    allowProduction: values.has("--allow-production"),
    protectedManual: values.has("--protected-manual"),
    anchorDay: values.get("--anchor"),
  };
}

export function comprehensiveDemoPlan(
  anchorDay: string,
  limit: number,
  minimumPaymentPercent: number,
) {
  validateAnchor(anchorDay);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new Error("Demo requires N in 1..20; global settings never changed");
  if (
    !Number.isInteger(minimumPaymentPercent) ||
    minimumPaymentPercent < 1 ||
    minimumPaymentPercent > 100
  )
    throw new Error("Invalid payment settings");
  const hours = Math.max(8, limit + 2);
  const formats = ["paid", "free", "retired"].map((key) => ({
    id: comprehensiveDemoId(`format:${key}`),
    name: `[DEMO] ${key === "paid" ? "Taller práctico" : key === "free" ? "Taller gratuito" : "Formato descontinuado"} · ${hours} h`,
    active: key !== "retired",
    totalHours: hours,
    sessionMinutes: 60,
    studentAmount: key === "paid" ? "80.00" : "0.00",
    externalAmount: key === "paid" ? "100.00" : "0.00",
  }));
  const definitions = [
    {
      key: "closed",
      name: "Resultados académicos",
      offset: -65,
      teacher: 0,
      components: 2,
      status: "PUBLISHED",
      scenarios: [
        "paid",
        "failed",
        "zero",
        "boundary",
        "warning",
        "ineligible",
        "partial",
      ],
    },
    {
      key: "reclosed",
      name: "Cierre corregido e historial",
      offset: -35,
      teacher: 1,
      components: 6,
      status: "PUBLISHED",
      scenarios: ["paid", "boundary", "failed"],
    },
    {
      key: "pending",
      name: "Evaluación pendiente",
      offset: -35,
      teacher: 2,
      components: 8,
      status: "PUBLISHED",
      scenarios: ["paid", "zero", "pending"],
    },
    {
      key: "current",
      name: "Asistencia y sesiones actuales",
      offset: -2,
      teacher: 3,
      components: 2,
      status: "PUBLISHED",
      scenarios: ["paid", "partial"],
    },
    {
      key: "future",
      name: "Inscripciones y movimientos",
      offset: 28,
      teacher: 0,
      components: 6,
      status: "PUBLISHED",
      scenarios: [
        "paid",
        "partial",
        "owed",
        "refunded",
        "transfer",
        "completed",
        "auxiliary",
        "external",
        "converted",
      ],
    },
    {
      key: "free",
      name: "Taller abierto gratuito",
      offset: 60,
      teacher: 1,
      components: 2,
      status: "PUBLISHED",
      scenarios: ["free", "free"],
    },
    {
      key: "draft",
      name: "Oferta en preparación",
      offset: 80,
      teacher: 2,
      components: 8,
      status: "DRAFT",
      scenarios: [],
    },
    {
      key: "archived",
      name: "Curso archivado",
      offset: -100,
      teacher: 3,
      components: 2,
      status: "ARCHIVED",
      scenarios: [],
    },
  ] as const;
  const now = boliviaCivilToInstant(`${anchorDay}T12:00`);
  const samples = definitions.map((def, index) => {
    let startDate = shiftedDay(anchorDay, def.offset);
    while ([0, 6].includes(new Date(`${startDate}T00:00:00Z`).getUTCDay()))
      startDate = shiftedDay(startDate, def.key === "current" ? -1 : 1);
    const format = formats[def.key === "free" ? 1 : 0]!;
    const dates = planCourseDates({ startDate, weekdaysMask: 31, ...format });
    const fixtureClock =
      startDate <= anchorDay
        ? boliviaCivilToInstant(`${shiftedDay(startDate, -8)}T12:00`)
        : now;
    const course = {
      id: comprehensiveDemoId(`course:${def.key}`),
      slug: `demo-comprehensive-v1-${def.key}`,
      name: `[DEMO] ${def.name}`,
      description:
        "Datos ficticios autorizados para explorar las funcionalidades actuales. No es una oferta real.",
      conditions:
        "Escenario sintético DEMO; ninguna operación representa efectivo real.",
      contentMarkdown:
        "## Programa de demostración\n\n- Fundamentos\n- Prácticas guiadas\n- Evaluación y resultados",
      level:
        index % 3 === 0
          ? ("BASIC" as const)
          : index % 3 === 1
            ? ("INTERMEDIATE" as const)
            : ("ADVANCED" as const),
      minimumGrade: 70,
      schedule: GROUP_SCHEDULE,
      weekdaysMask: 31,
      ...dates,
      registrationStartAt: boliviaCivilToInstant(
        `${shiftedDay(startDate < anchorDay ? startDate : anchorDay, -14)}T00:00`,
      ),
      registrationEndAt: boliviaCivilToInstant(
        `${shiftedDay(startDate, -1)}T00:00`,
      ),
      status: def.status,
      featured: false,
      courseTypeRevisionId: comprehensiveDemoId(`revision:${format.id}`),
    };
    const groups = (
      def.key === "future" ? ["09:00", "11:00", "13:00"] : ["09:00"]
    ).map((time, i) => ({
      id: comprehensiveDemoId(`group:${def.key}:${i}`),
      courseId: course.id,
      courseTypeRevisionId: course.courseTypeRevisionId,
      capacity: 20,
      publishedAt: def.status === "DRAFT" ? null : fixtureClock,
      status: i === 2 ? ("CANCELLED" as const) : ("PLANNED" as const),
      ...groupPlan({ ...dates, weekdaysMask: 31 }, format, time),
    }));
    const components = Array.from({ length: def.components }, (_, i) => ({
      id: comprehensiveDemoId(`component:${def.key}:${i}`),
      name: `${i % 2 === 0 ? "Teoría" : "Práctica"} ${i + 1}`,
      type: i % 2 === 0 ? ("THEORY" as const) : ("PRACTICAL" as const),
      weight: (
        (Math.floor(10000 / def.components) +
          (i === def.components - 1 ? 10000 % def.components : 0)) /
        100
      ).toFixed(2),
    }));
    const registrations = def.scenarios.map((scenario, i) => ({
      key: `${def.key}:${i}`,
      scenario,
      participant: {
        ci: `00CDV1${index}${String(i).padStart(3, "0")}LP`,
        firstName: [
          "Camila",
          "Mateo",
          "Lucía",
          "Diego",
          "Elena",
          "Andrés",
          "Sofía",
          "Valeria",
          "Daniel",
        ][i]!,
        lastName: "Demo",
        email: `comprehensive.v1.${def.key}.${i}@example.test`,
        phone: null,
      },
    }));
    return {
      key: def.key,
      teacher: def.teacher,
      course,
      groups,
      components,
      fixtureClock,
      registrations,
    };
  });
  // Global participant identity is shared explicitly by CI, not by a common
  // synthetic name/email. This demonstrates independent multi-course history.
  samples
    .find((s) => s.key === "future")!
    .registrations.find((r) => r.scenario === "converted")!.participant = {
    ...samples.find((s) => s.key === "closed")!.registrations[0]!.participant,
  };
  return {
    owner: COMPREHENSIVE_DEMO_OWNER,
    anchorDay,
    now,
    limit,
    minimumPaymentPercent,
    formats,
    samples,
  };
}
export type ComprehensiveDemoPlan = ReturnType<typeof comprehensiveDemoPlan>;
export interface ComprehensiveDemoContext {
  owner: string;
  anchorDay: string;
  courses: Record<string, { courseId: string; groupIds: string[] }>;
  registrations: Record<string, string>;
  instructors: string[];
  admins: Record<string, string>;
}
