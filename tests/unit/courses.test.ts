import { describe, expect, spyOn, test } from "bun:test";

import { createCourse } from "@/application/courses/manage-courses";
import { courseAcademicPhase } from "@/domain/courses/academic-phase";
import { createFormat } from "@/application/courses/manage-formats";
import type { FormatRepository } from "@/application/courses/format-repository";
import type { CourseRepository } from "@/application/courses/course-repository";
import type { InternalUser } from "@/domain/auth/types";
import {
  boliviaCivilToInstant,
  instantToBoliviaCivil,
} from "@/domain/courses/bolivia-time";
import { CourseDomainError } from "@/domain/courses/errors";
import {
  assertTransition,
  normalizeSlug,
  registrationAvailability,
} from "@/domain/courses/policies";
import { validateCourseData } from "@/domain/courses/validation";
import { validateFormat } from "@/domain/courses/formats";
import {
  COURSE_INFRASTRUCTURE_STATUS,
  courseDomainStatus,
  logCourseInfrastructureError,
} from "@/server/courses/errors";
import { CourseInfrastructureError } from "@/server/db/repositories/course-infrastructure-error";
import { courseInputFromFormData } from "@/server/courses/form";
import { courseEditability } from "@/domain/courses/editability";
import { restoreDisabledCourseFields } from "@/domain/courses/form-input";
import type { AdminCourseDto } from "@/domain/courses/types";
import {
  buildCourseReport,
  loadCourseReport,
  parseCourseReportFilter,
} from "@/application/courses/course-report";
import { matchesCourseSearch } from "@/domain/courses/report-filters";
import { renderCoursesCsv } from "@/server/courses/exports/csv";
import { renderCoursesPdf } from "@/server/courses/exports/pdf";
import { groupSchedule } from "@/server/courses/exports/columns";
import { PDFDocument, PDFPage } from "pdf-lib";
import {
  courseReportNow,
  courseReportSource,
} from "../fixtures/course-reports";
import { exportActor } from "./registration-export-fixture";

const validInput = {
  courseTypeId: "00000000-0000-4000-8000-000000000001",
  name: "  Programación Ágil  ",
  description: "Fundamentos y práctica.",
  level: "BASIC",
  totalHours: "20",
  schedule: "Lunes 18:00",
  conditions: "Cupo sujeto a confirmación.",
  startsAt: "2027-01-10T18:00",
  endsAt: "2027-02-10T18:00",
  registrationStartAt: "2026-12-01T12:00",
  registrationEndAt: "2027-01-09T12:00",
  minimumGrade: "70",
  studentAmount: "80",
  externalAmount: "100.5",
} as const;

describe("course domain", () => {
  test("normalizes stable slug candidates", () => {
    expect(normalizeSlug("  Diseño de APIs: Nivel 2 ")).toBe(
      "diseno-de-apis-nivel-2",
    );
    expect(() => normalizeSlug("---")).toThrow();
  });

  test("accepts valid data and keeps commercial terms on the format", () => {
    const result = validateCourseData(validInput);
    expect(result.name).toBe("Programación Ágil");
    expect(result.level).toBe("BASIC");
    expect(result.courseTypeId).toBe(validInput.courseTypeId);
    expect(validateFormat("Formato", "20", "80", "100.5")).toMatchObject({
      studentAmount: "80.00",
      externalAmount: "100.50",
    });
    expect(result.startsAt.toISOString()).toBe("2027-01-10T22:00:00.000Z");
    const now = new Date("2026-10-17T12:00Z");
    const policy = courseEditability(
      { ...result, status: "PUBLISHED" },
      true,
      true,
      now,
    );
    expect(policy).toEqual({
      content: true,
      format: false,
      instructor: true,
      dates: true,
      schedule: false,
    });
    expect(
      courseEditability({ ...result, status: "PUBLISHED" }, true, false, now),
    ).toMatchObject({ content: true, dates: false });
    expect(
      courseEditability(
        { ...result, status: "PUBLISHED" },
        true,
        true,
        result.startsAt,
      ),
    ).toMatchObject({ content: true, instructor: false, dates: false });
    expect(
      Object.values(
        courseEditability({ ...result, status: "ARCHIVED" }, false, true, now),
      ),
    ).toEqual([false, false, false, false, false]);
    const stored: AdminCourseDto = {
      ...result,
      id: "course",
      slug: "course",
      courseTypeRevisionId: "revision",
      totalHours: 20,
      sessionMinutes: 90,
      prices: [],
      featured: false,
      status: "PUBLISHED",
      createdAt: now,
      updatedAt: now,
      registrationAvailability: "UPCOMING",
      editability: { ...policy, dates: false, instructor: false },
    };
    const omitted = courseInputFromFormData(new FormData());
    expect(omitted.courseTypeId).toBeUndefined();
    expect(restoreDisabledCourseFields(omitted, stored)).toMatchObject({
      courseTypeId: result.courseTypeId,
      startsAt: validInput.startsAt,
      endsAt: validInput.endsAt,
      instructorId: "",
      schedule: result.schedule,
    });
    expect(
      restoreDisabledCourseFields(
        { courseTypeId: "tampered", startsAt: "tampered" },
        stored,
      ),
    ).toMatchObject({ courseTypeId: "tampered", startsAt: "tampered" });
  });

  test("converts Bolivia civil time symmetrically without process timezone", () => {
    const instant = boliviaCivilToInstant("2027-03-01T18:30");
    expect(instant.toISOString()).toBe("2027-03-01T22:30:00.000Z");
    expect(instantToBoliviaCivil(instant)).toBe("2027-03-01T18:30");
    for (const invalid of [
      "2027-02-29T10:00",
      "2028-02-30T10:00",
      "2027-13-01T10:00",
      "2027-01-01T24:00",
      "2027-01-01T10:00:00",
      "2027-01-01 10:00",
    ])
      expect(() => boliviaCivilToInstant(invalid)).toThrow();
  });

  test("normalizes date-only registration windows to Bolivia civil days", () => {
    const fields = new FormData();
    fields.set("registrationStartDate", "2027-01-01");
    fields.set("registrationEndDate", "2027-01-09");
    fields.set("registrationStartAt", "2026-12-01T12:00");
    fields.set("registrationEndAt", "2027-01-09T12:00");
    const parsed = courseInputFromFormData(fields);
    expect(parsed.registrationStartDate).toBe("2027-01-01");
    expect(parsed.registrationEndDate).toBe("2027-01-09");
    const result = validateCourseData({
      ...validInput,
      startsAt: "2027-01-10T00:00",
      registrationStartDate: parsed.registrationStartDate,
      registrationEndDate: parsed.registrationEndDate,
    });
    expect(result.registrationStartAt?.toISOString()).toBe(
      "2027-01-01T04:00:00.000Z",
    );
    expect(result.registrationEndAt?.toISOString()).toBe(
      "2027-01-10T04:00:00.000Z",
    );
    expect(() =>
      validateCourseData({
        ...validInput,
        registrationStartDate: "2027-02-30",
        registrationEndDate: "2027-03-01",
      }),
    ).toThrow();
    expect(() =>
      validateCourseData({
        ...validInput,
        registrationStartDate: "2027-01-01",
        registrationEndDate: "2027-01-10",
      }),
    ).toThrow();
  });

  test("keeps the weekday planner's calculated endsAt on create", () => {
    const fields = new FormData();
    fields.set("startDate", "2027-03-01");
    fields.set("startsAt", "2027-03-01T00:00");
    fields.set("endsAt", "2027-03-17T23:59");

    const parsed = courseInputFromFormData(fields);

    expect(parsed.startsAt).toBe("2027-03-01T00:00");
    expect(parsed.endsAt).toBe("2027-03-17T23:59");
  });

  test("preserves legacy registration datetimes when date-only controls are absent", () => {
    const formData = new FormData();
    formData.set("registrationStartAt", "2026-12-01T12:00");
    formData.set("registrationEndAt", "2027-01-09T12:00");
    const parsed = courseInputFromFormData(formData);
    expect(parsed.registrationStartDate).toBeUndefined();
    expect(parsed.registrationEndDate).toBeUndefined();
    const result = validateCourseData({
      ...validInput,
      registrationStartAt: parsed.registrationStartAt,
      registrationEndAt: parsed.registrationEndAt,
      registrationStartDate: parsed.registrationStartDate,
      registrationEndDate: parsed.registrationEndDate,
    });
    expect(result.registrationStartAt?.toISOString()).toBe(
      "2026-12-01T16:00:00.000Z",
    );
    expect(result.registrationEndAt?.toISOString()).toBe(
      "2027-01-09T16:00:00.000Z",
    );
  });

  test("requires an explicit minimum grade while accepting zero", () => {
    for (const minimumGrade of [undefined, "", "   "])
      expect(() =>
        validateCourseData({ ...validInput, minimumGrade }),
      ).toThrow();
    expect(
      validateCourseData({ ...validInput, minimumGrade: "0" }).minimumGrade,
    ).toBe(0);
    for (const minimumGrade of ["1e2", "0x64", "+70", "70.0", "-1"])
      expect(() =>
        validateCourseData({ ...validInput, minimumGrade }),
      ).toThrow();
  });

  test("rejects text control characters while allowing multiline formatting", () => {
    for (const [field, value] of [
      ["name", "Curso\u0001"],
      ["instructorName", "Docente\u007f"],
      ["description", "Texto\u0000"],
      ["conditions", "Texto\u000b"],
      ["contentMarkdown", "Texto\u001f"],
      ["schedule", "Lunes\n18:00"],
    ] as const) {
      try {
        validateCourseData({ ...validInput, [field]: value });
        throw new Error(`Expected ${field} control-character rejection`);
      } catch (error) {
        expect(error).toMatchObject({
          code: "VALIDATION_FAILED",
          fieldErrors: { [field]: expect.any(String) },
        });
      }
    }
    expect(
      validateCourseData({
        ...validInput,
        description: "Texto\ncon\ttab",
        conditions: "Condición\ncon detalle\t",
        contentMarkdown: "## Tema\n- Unidad\tuno",
      }).description,
    ).toBe("Texto\ncon\ttab");
  });

  test("rejects invalid dates, partial registration windows, grade, duration and money", () => {
    expect(() => validateFormat(" ", "0", "10.999", "-1")).toThrow();
    expect(() =>
      validateCourseData({
        ...validInput,
        totalHours: "0",
        minimumGrade: "101",
        endsAt: validInput.startsAt,
        registrationEndAt: "",
        studentAmount: "10.999",
        externalAmount: "-1",
      }),
    ).toThrow();
    try {
      validateCourseData({ ...validInput, registrationEndAt: "" });
    } catch (error) {
      expect(error).toMatchObject({
        code: "VALIDATION_FAILED",
        fieldErrors: {
          registrationStartAt: expect.any(String),
          registrationEndAt: expect.any(String),
        },
      });
    }
  });

  test("allows only publish, withdraw and archive transitions", () => {
    expect(() => assertTransition("DRAFT", "PUBLISHED")).not.toThrow();
    expect(() => assertTransition("PUBLISHED", "DRAFT")).not.toThrow();
    expect(() => assertTransition("DRAFT", "ARCHIVED")).not.toThrow();
    expect(() => assertTransition("PUBLISHED", "ARCHIVED")).not.toThrow();
    expect(() => assertTransition("ARCHIVED", "DRAFT")).toThrow();
    expect(() => assertTransition("DRAFT", "DRAFT")).toThrow();
  });

  test("derives registration availability and academic phase without persisting them", async () => {
    const now = new Date("2027-01-05T12:00:00Z");
    expect(registrationAvailability(null, null, now)).toBe("UNAVAILABLE");
    expect(
      registrationAvailability(
        new Date("2027-01-06Z"),
        new Date("2027-01-10Z"),
        now,
      ),
    ).toBe("UPCOMING");
    expect(
      registrationAvailability(
        new Date("2027-01-01Z"),
        new Date("2027-01-10Z"),
        now,
      ),
    ).toBe("OPEN");
    expect(
      registrationAvailability(
        new Date("2027-01-01Z"),
        new Date("2027-01-05T12:00:00Z"),
        now,
      ),
    ).toBe("CLOSED");
    const started = {
      status: "PLANNED",
      startsAt: now,
      academicallyClosed: false,
    } as const;
    const future = { ...started, startsAt: new Date(now.getTime() + 1) };
    const closed = { ...started, academicallyClosed: true };
    const cancelled = { ...started, status: "CANCELLED" } as const;
    expect(courseAcademicPhase([], now)).toBe("NO_ACTIVE_GROUPS");
    expect(courseAcademicPhase([cancelled], now)).toBe("NO_ACTIVE_GROUPS");
    expect(courseAcademicPhase([closed, future, cancelled], now)).toBe(
      "UPCOMING",
    );
    expect(courseAcademicPhase([started, future], now)).toBe("IN_PROGRESS");
    expect(courseAcademicPhase([closed, cancelled], now)).toBe("FINISHED");
    expect(
      courseAcademicPhase([{ ...closed, academicallyClosed: false }], now),
    ).toBe("IN_PROGRESS");
    const filter = parseCourseReportFilter({
      status: "ALL",
      search: "  DISEÑO  Ágil ",
    });
    expect(filter.search).toBe("diseno agil");
    expect(parseCourseReportFilter({}).status).toBe("PUBLISHED");
    expect(() => parseCourseReportFilter({ status: "CANCELLED" })).toThrow();
    expect(() =>
      parseCourseReportFilter({ search: "x".repeat(501) }),
    ).toThrow();
    expect(
      matchesCourseSearch({ name: "Diseño Ágil", slug: "otro" }, filter.search),
    ).toBe(true);
    expect(
      matchesCourseSearch({ name: "Otro", slug: "diseno-agil" }, "diseno-agil"),
    ).toBe(true);
    const source = courseReportSource();
    const report = buildCourseReport(
      source,
      { search: "", status: "ALL" },
      courseReportNow,
    );
    expect(report).toMatchObject({
      uniqueEnrolled: 2,
      netCents: "22000",
      groupCount: 4,
    });
    expect(report.courses[0]).toMatchObject({
      enrolled: 2,
      netCents: "19000",
      instructorName: "María José Álvarez Quiñónez",
      groups: [
        { enrolled: 1, netCents: "9000", passed: 0, notPassed: 1 },
        { enrolled: 2, netCents: "10000", passed: null, notPassed: null },
      ],
    });
    expect(report.courses[0]!.groups[0]!.endsAt.toISOString()).toBe(
      "2026-01-24T15:30:00.000Z",
    );
    expect(report.courses[2]).toMatchObject({
      enrolled: 0,
      netCents: "0",
      instructorName: "Sin asignar",
      groups: [],
    });
    expect(report.courses[3]!.groups[0]).toMatchObject({
      enrolled: 0,
      netCents: "0",
      passed: null,
    });
    const legacyGroup = {
      ...report.courses[0]!.groups[1]!,
      weekdaysMask: null,
    };
    expect(groupSchedule(legacyGroup)).toBe("10:00–11:30");
    expect(groupSchedule(report.courses[0]!.groups[1]!)).toContain(
      "Lun, Mar, Mié, Jue, Vie",
    );
    const csv = renderCoursesCsv(report);
    expect([...csv.slice(0, 3)]).toEqual([239, 187, 191]);
    const content = new TextDecoder().decode(csv);
    expect(content).toContain(
      '"María José Álvarez Quiñónez",100.00,150.00,50.00',
    );
    expect(content).toContain('"Borrador sin grupos"');
    expect(content).toContain("90.00,0,1");
    expect(content).not.toMatch(
      /person-a|registration-a|CANCELADO|SALDOVENCIDO|PREINSCRITO|Estado financiero|Saldo|CI,/u,
    );
    source.courses[0]!.name = "=SUM(A1:A3)";
    expect(
      new TextDecoder().decode(
        renderCoursesCsv(buildCourseReport(source, filter, courseReportNow)),
      ),
    ).toContain('"\'=SUM(A1:A3)"');
    source.groups[0]!.officialVersion = 1;
    expect(() => buildCourseReport(source, filter, courseReportNow)).toThrow(
      "conciliar",
    );
    source.groups[0]!.officialVersion = 2;
    source.groups[0]!.officialParticipants = [];
    expect(() => buildCourseReport(source, filter, courseReportNow)).toThrow(
      "conciliar",
    );
    source.groups[0]!.closed = false;
    expect(
      buildCourseReport(source, filter, courseReportNow).courses[0]!.groups[0]!
        .passed,
    ).toBeNull();
    expect(() =>
      buildCourseReport({ ...source, courses: [] }, filter, courseReportNow),
    ).toThrow("No hay cursos");
    expect(() =>
      buildCourseReport(
        {
          ...source,
          groups: Array.from({ length: 1001 }, () => source.groups[0]!),
        },
        filter,
        courseReportNow,
      ),
    ).toThrow("1000");
    const pdf = await renderCoursesPdf(report);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
    const tallSource = courseReportSource();
    const longName =
      "Especialización en programación y análisis de sistemas de información para la gestión académica e institucional avanzada y el desarrollo de soluciones de interoperabilidad y automatización de procesos universitarios con gobernanza y planificación de infraestructuras tecnológicas";
    tallSource.courses = [{ ...tallSource.courses[0]!, name: longName }];
    tallSource.groups = [tallSource.groups[0]!];
    tallSource.registrations = [tallSource.registrations[0]!];
    tallSource.sessions = Array.from({ length: 44 }, (_, index) => ({
      groupId: tallSource.groups[0]!.id,
      startsAt: new Date(Date.UTC(2026, 0, 5 + index, 12, index)),
      endsAt: new Date(Date.UTC(2026, 0, 5 + index, 13, index + 30)),
    }));
    const draws: { page: PDFPage; text: string; y: number }[] = [];
    const originalDraw = PDFPage.prototype.drawText;
    const draw = spyOn(PDFPage.prototype, "drawText").mockImplementation(
      function (this: PDFPage, value, options) {
        draws.push({ page: this, text: value, y: options?.y ?? 0 });
        return originalDraw.call(this, value, options);
      },
    );
    try {
      const tallPdf = await renderCoursesPdf(
        buildCourseReport(tallSource, filter, courseReportNow),
      );
      expect((await PDFDocument.load(tallPdf)).getPageCount()).toBeGreaterThan(
        1,
      );
      const body = draws.filter(
        ({ text }) =>
          text !== "Informe de cursos" && !/^\d+ \/ \d+$/u.test(text),
      );
      expect(body.every(({ y }) => y >= 48)).toBe(true);
      const allText = draws.map(({ text }) => text).join(" ");
      expect(allText.replace(/\s/gu, "")).toContain(
        longName.replace(/\s/gu, ""),
      );
      for (let minute = 0; minute < 44; minute++) {
        const time = `08:${minute.toString().padStart(2, "0")}–`;
        expect(allText.split(time)).toHaveLength(2);
      }
      for (const page of new Set(draws.map((row) => row.page))) {
        const content = draws
          .filter((row) => row.page === page)
          .map((row) => row.text);
        if (content.includes("Grupo / horario"))
          expect(content.some((value) => /^Grupo 1/u.test(value))).toBe(true);
      }
    } finally {
      draw.mockRestore();
    }
    const badText = structuredClone(report);
    badText.courses[0]!.name = "漢字";
    await expect(renderCoursesPdf(badText)).rejects.toMatchObject({
      code: "PDF_UNSUPPORTED_TEXT",
    });
    let reads = 0;
    await expect(
      loadCourseReport(
        {
          read: async () => {
            reads++;
            return source;
          },
        },
        { ...exportActor, roles: ["INSTRUCTOR"] },
        {},
      ),
    ).rejects.toThrow();
    expect(reads).toBe(0);
  });

  test("course use cases reject invited and disabled admins before persistence", async () => {
    let called = false;
    const repository = {
      create: async () => {
        called = true;
        throw new Error("must not be called");
      },
    } as unknown as CourseRepository;
    const baseUser: InternalUser = {
      id: "user-id",
      authUserId: null,
      email: "admin@example.test",
      name: "Admin",
      status: "INVITED",
      roles: ["ADMIN"],
    };
    for (const status of ["INVITED", "DISABLED"] as const) {
      try {
        await createCourse(repository, { ...baseUser, status }, validInput);
        throw new Error("Expected authorization rejection");
      } catch (error) {
        expect(error).toMatchObject({
          code: status === "DISABLED" ? "DISABLED" : "NOT_INVITED",
        });
      }
    }
    expect(called).toBe(false);
  });

  test("format cases enforce active ADMIN and validate terms before storage", async () => {
    let called = false;
    const repository = {
      create: async () => {
        called = true;
        throw new Error("should not persist");
      },
    } as unknown as FormatRepository;
    const user: InternalUser = {
      id: "user-id",
      authUserId: null,
      email: "user@example.test",
      name: "User",
      status: "ACTIVE",
      roles: ["INSTRUCTOR"],
    };
    const form = {
      name: "Ejemplo",
      totalHours: "20",
      studentAmount: "80",
      externalAmount: "100",
    };
    for (const [actor, candidate, code] of [
      [user, form, "FORBIDDEN"],
      [
        { ...user, roles: ["ADMIN"] },
        { ...form, totalHours: "-1" },
        "VALIDATION_FAILED",
      ],
    ] as const) {
      try {
        await createFormat(repository, actor, candidate);
        throw new Error("Expected rejection");
      } catch (error) {
        expect(error).toMatchObject({ code });
      }
    }
    expect(called).toBe(false);
  });

  test("logs infrastructure failures without leaking the database cause", () => {
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const error = new CourseInfrastructureError(
        "update",
        "internal",
        new Error("password=secret sql=select * from users"),
      );
      logCourseInfrastructureError(error, {
        actorId: "actor-id",
        courseId: "course-id",
      });
      expect(log).toHaveBeenCalledTimes(1);
      const serialized = JSON.stringify(log.mock.calls[0]);
      expect(serialized).toContain("course_infrastructure_error");
      expect(serialized).not.toContain("password");
      expect(serialized).not.toContain("select *");
    } finally {
      log.mockRestore();
    }
  });

  test("maps course conflicts and infrastructure failures to HTTP status", () => {
    expect(
      courseDomainStatus(new CourseDomainError("STALE_COURSE", "stale")),
    ).toBe(409);
    expect(
      courseDomainStatus(new CourseDomainError("VALIDATION_FAILED", "invalid")),
    ).toBe(422);
    expect(COURSE_INFRASTRUCTURE_STATUS).toBe(500);
  });
});
