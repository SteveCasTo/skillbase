import { describe, expect, test } from "bun:test";
import { dateTimeUnavailable } from "@/components/courses/CourseDateTimePicker";

const day = (iso: string) => new Date(`${iso}T12:00:00`);
const today = "2026-09-27";

describe("historical course date/time calendar availability", () => {
  test("only class starts apply weekday and future restrictions", () => {
    const bounds = { start: "", registrationStart: "", registrationEnd: "" };
    expect(
      dateTimeUnavailable(
        "startsAt",
        day("2026-09-26"),
        "10:00",
        bounds,
        today,
        true,
        true,
      ),
    ).toBe(true);
    expect(
      dateTimeUnavailable(
        "startsAt",
        day("2026-09-28"),
        "10:00",
        bounds,
        today,
        true,
        true,
      ),
    ).toBe(false);
    expect(
      dateTimeUnavailable(
        "registrationStartAt",
        day("2026-09-26"),
        "10:00",
        bounds,
        today,
        false,
        false,
      ),
    ).toBe(false);
    expect(
      dateTimeUnavailable(
        "registrationEndAt",
        day("2026-09-26"),
        "10:00",
        bounds,
        today,
        false,
        false,
      ),
    ).toBe(false);
  });

  test("opening precedes closing, and closing cannot pass the class start", () => {
    const bounds = {
      start: "2026-10-05T09:00",
      registrationStart: "2026-10-04T08:00",
      registrationEnd: "2026-10-04T18:00",
    };
    const unavailable = (name: string, date: string, time: string) =>
      dateTimeUnavailable(name, day(date), time, bounds, today, false, false);
    expect(unavailable("registrationStartAt", "2026-10-04", "18:00")).toBe(
      true,
    );
    expect(unavailable("registrationStartAt", "2026-10-04", "17:59")).toBe(
      false,
    );
    expect(unavailable("registrationStartAt", "2026-10-05", "08:00")).toBe(
      true,
    );
    expect(
      dateTimeUnavailable(
        "registrationStartAt",
        day("2026-10-05"),
        "08:00",
        { ...bounds, registrationEnd: "" },
        today,
        false,
        false,
      ),
    ).toBe(false);
    expect(
      dateTimeUnavailable(
        "registrationStartAt",
        day("2026-10-05"),
        "09:00",
        { ...bounds, registrationEnd: "" },
        today,
        false,
        false,
      ),
    ).toBe(true);
    expect(unavailable("registrationEndAt", "2026-10-04", "08:00")).toBe(true);
    expect(unavailable("registrationEndAt", "2026-10-04", "08:01")).toBe(false);
    expect(unavailable("registrationEndAt", "2026-10-05", "09:00")).toBe(false);
    expect(unavailable("registrationEndAt", "2026-10-05", "09:01")).toBe(true);
    expect(unavailable("registrationEndAt", "2026-10-06", "")).toBe(true);
  });

  test("does not disable a same-day calendar choice before the user enters an hour", () => {
    const bounds = {
      start: "2026-10-05T09:00",
      registrationStart: "2026-10-04T08:00",
      registrationEnd: "2026-10-04T18:00",
    };
    expect(
      dateTimeUnavailable(
        "registrationEndAt",
        day("2026-10-05"),
        "",
        bounds,
        today,
        false,
        false,
      ),
    ).toBe(false);
    expect(
      dateTimeUnavailable(
        "registrationStartAt",
        day("2026-10-04"),
        "",
        bounds,
        today,
        false,
        false,
      ),
    ).toBe(false);
  });
});
