import { describe, expect, it } from "bun:test";

import { registrationWindow } from "../../src/components/public-courses/course-details";
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

  it("omits incomplete registration windows", () => {
    expect(
      registrationWindow({ registrationStartAt: null } as PublicCourseDto),
    ).toBeNull();
  });
});
