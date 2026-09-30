import { describe, expect, it } from "bun:test";

import {
  civilDate,
  registrationWindow,
} from "../../src/components/public-courses/course-details";
import type { PublicCourseDto } from "../../src/domain/courses/types";

describe("course detail registration dates", () => {
  it("separates opening and closing dates in Bolivia without hours", () => {
    const course = {
      registrationStartAt: new Date("2026-09-18T00:57:00Z"),
      registrationEndAt: new Date("2026-10-25T00:57:00Z"),
    } as PublicCourseDto;

    expect(registrationWindow(course)).toEqual({
      opens: "17 de septiembre de 2026",
      closes: "24 de octubre de 2026",
    });
  });

  it("shows the inclusive final Bolivia day for midnight-exclusive registration windows", () => {
    const course = {
      registrationStartAt: new Date("2027-01-01T04:00:00Z"),
      registrationEndAt: new Date("2027-02-21T04:00:00Z"),
    } as PublicCourseDto;

    expect(registrationWindow(course)).toEqual({
      opens: "1 de enero de 2027",
      closes: "20 de febrero de 2027",
    });
  });

  it("preserves the closing civil day of a historical non-midnight instant", () => {
    const course = {
      registrationStartAt: new Date("2026-09-18T00:57:00Z"),
      registrationEndAt: new Date("2026-10-25T04:00:30Z"),
    } as PublicCourseDto;
    expect(registrationWindow(course)?.closes).toBe("25 de octubre de 2026");
  });

  it("renders course start and finish as Bolivia civil dates without hours", () => {
    expect(civilDate(new Date("2027-03-01T04:00:00Z"))).toBe(
      "1 de marzo de 2027",
    );
    expect(civilDate(new Date("2027-03-18T03:59:00Z"))).toBe(
      "17 de marzo de 2027",
    );
  });

  it("omits incomplete registration windows", () => {
    expect(
      registrationWindow({ registrationStartAt: null } as PublicCourseDto),
    ).toBeNull();
  });
});
