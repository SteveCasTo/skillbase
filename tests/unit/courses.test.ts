import { describe, expect, spyOn, test } from "bun:test";

import { createCourse } from "@/application/courses/manage-courses";
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

  test("derives registration availability without persisting it", () => {
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
