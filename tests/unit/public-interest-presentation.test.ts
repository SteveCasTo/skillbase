import { describe, expect, test } from "bun:test";
import {
  EMPTY_INTEREST_VALUES,
  INTEREST_SUCCESS_MESSAGE,
  interestGroupLabel,
  isPublicInterestPayload,
} from "@/components/public-courses/public-interest-presentation";

describe("public interest presentation", () => {
  test("labels only the civil group schedule, not capacity or identifiers", () => {
    expect(interestGroupLabel({ startTime: "18:00", endTime: "19:30" })).toBe(
      "Lunes a viernes, 18:00–19:30",
    );
    expect(Object.values(EMPTY_INTEREST_VALUES)).toEqual(["", "", "", "", ""]);
  });
  test("accepts only the neutral success transport", () => {
    expect(
      isPublicInterestPayload({ ok: true, message: INTEREST_SUCCESS_MESSAGE }),
    ).toBe(true);
    expect(
      isPublicInterestPayload({ ok: true, message: "Inscripción confirmada" }),
    ).toBe(false);
  });
  test("accepts safe field issues and rejects malformed transport", () => {
    expect(
      isPublicInterestPayload({
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Revisa los campos indicados.",
        issues: {
          preferredGroupId:
            "Selecciona una preferencia disponible o continúa sin preferencia.",
        },
      }),
    ).toBe(true);
    for (const value of [
      null,
      [],
      { ok: false },
      { ok: false, code: "X", message: "X", issues: [] },
      { ok: false, code: "X", message: "X", issues: { capacity: "1" } },
      { ok: false, code: "X", message: "X", issues: { email: 3 } },
    ])
      expect(isPublicInterestPayload(value)).toBe(false);
  });
});
