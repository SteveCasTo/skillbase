import { describe, expect, test } from "bun:test";
import {
  acceptsCourseInput,
  draftFieldsReady,
  nextCourseInput,
} from "../../src/components/courses/course-input-filter";

describe("course editor input admission", () => {
  test("rejects whole invalid edits while retaining intermediate date, time and grade states", () => {
    for (const [kind, partial, invalid] of [
      ["date", "02/0", "02/a"],
      ["time", "18:", "18:x"],
      ["grade", "10", "101"],
    ] as const) {
      expect(acceptsCourseInput(kind, partial)).toBe(true);
      expect(nextCourseInput(kind, partial, invalid)).toBe(partial);
    }
    expect(acceptsCourseInput("date", "01/03/2027")).toBe(true);
    expect(acceptsCourseInput("date", "30/02/2027")).toBe(true); // calendar validity is separate
    expect(acceptsCourseInput("date", "01/03/2027evil")).toBe(false);
    expect(acceptsCourseInput("time", "29:99")).toBe(false);
    expect(acceptsCourseInput("time", "23:59")).toBe(true);
    expect(acceptsCourseInput("date", "39/02/2027")).toBe(false);
    expect(acceptsCourseInput("date", "30/13/2027")).toBe(false);
    expect(acceptsCourseInput("grade", "0")).toBe(true);
    expect(acceptsCourseInput("grade", "1e2")).toBe(false);
    expect(acceptsCourseInput("grade", "-1")).toBe(false);
    expect(acceptsCourseInput("grade", "100.0")).toBe(false);
  });

  test("keeps Unicode, punctuation and Markdown, but rejects control characters", () => {
    expect(acceptsCourseInput("text", "Ñandú — 李 🎓")).toBe(true);
    expect(acceptsCourseInput("multiline", "## Música 🎶\n- Día\tuno")).toBe(
      true,
    );
    expect(acceptsCourseInput("text", "hola\nmal")).toBe(false);
    expect(acceptsCourseInput("multiline", "hola\u0000mal")).toBe(false);
  });
});

const complete = {
  name: "Curso",
  description: "Descripción",
  level: "BASIC",
  courseTypeId: "format",
  schedule: "Lunes, 18:00–20:00",
  conditions: "Condiciones",
  minimumGrade: "0",
  startsAt: "2027-03-01T18:00",
  endsAt: "2027-04-01T18:00",
  registrationStartAt: "",
  registrationEndAt: "",
};

test("draft readiness requires valid required fields but not optional content", () => {
  expect(draftFieldsReady(complete)).toBe(true);
  for (const field of [
    "name",
    "description",
    "level",
    "courseTypeId",
    "schedule",
    "conditions",
    "startsAt",
    "endsAt",
    "minimumGrade",
  ]) {
    expect(draftFieldsReady({ ...complete, [field]: "" })).toBe(false);
  }
  expect(draftFieldsReady({ ...complete, minimumGrade: "101" })).toBe(false);
  expect(draftFieldsReady({ ...complete, startsAt: "2027-02-30T18:00" })).toBe(
    false,
  );
  expect(draftFieldsReady({ ...complete, endsAt: complete.startsAt })).toBe(
    false,
  );
  expect(
    draftFieldsReady({ ...complete, registrationStartAt: "2027-01-01T08:00" }),
  ).toBe(false);
  expect(
    draftFieldsReady({
      ...complete,
      registrationStartAt: "2027-01-02T08:00",
      registrationEndAt: "2027-01-01T08:00",
    }),
  ).toBe(false);
  expect(
    draftFieldsReady({
      ...complete,
      registrationStartAt: "2027-01-01T08:00",
      registrationEndAt: "2027-01-02T08:00",
    }),
  ).toBe(true);
});
