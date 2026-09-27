import { describe, expect, test } from "bun:test";

import { validateFormat, validateFormatName } from "@/domain/courses/formats";

describe("format name validation", () => {
  test("rejects control characters when creating or renaming a format", () => {
    for (const name of [
      "Formato\ninválido",
      "Formato\u007finválido",
      "\tFormato válido",
    ]) {
      expect(() => validateFormat(name, "24", "80", "100")).toThrow(
        "Revisa los campos indicados.",
      );
      expect(() => validateFormatName(name)).toThrow(
        "Revisa los campos indicados.",
      );
    }
  });

  test("preserves Unicode names", () => {
    const name = "Formato humano ñ · 東京 😀";
    expect(validateFormat(name, "24", "80", "100").name).toBe(name);
    expect(validateFormatName(name)).toBe(name);
  });
  test("validates explicit session duration and distinguishes unresolved legacy", () => {
    expect(
      validateFormat("Sample", "20", "80", "100", "90").sessionMinutes,
    ).toBe(90);
    expect(
      validateFormat("Legacy", "20", "80", "100").sessionMinutes,
    ).toBeNull();
    for (const minutes of ["", "0", "14", "481", "90.5", "Infinity"])
      expect(() =>
        validateFormat("Sample", "20", "80", "100", minutes),
      ).toThrow();
  });
});
