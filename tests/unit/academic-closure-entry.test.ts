import { expect, test } from "bun:test";
import { assertAcademicRegistrationDestination } from "@/domain/pre-registrations/policies";
import { registrationFailure } from "@/server/pre-registrations/http";
import { RegistrationError } from "@/domain/pre-registrations/errors";

test("academic group entry requires an open target and reports the relevant registration field", () => {
  expect(() => assertAcademicRegistrationDestination(false)).not.toThrow();
  expect(() =>
    assertAcademicRegistrationDestination(false, "destinationGroupId"),
  ).not.toThrow();
  for (const field of ["groupId", "destinationGroupId"] as const) {
    try {
      assertAcademicRegistrationDestination(true, field);
      throw new Error("Expected closed target rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(RegistrationError);
      expect(error).toMatchObject({
        code: "GROUP_CLOSED",
        issues: { [field]: expect.any(String) },
      });
    }
  }
});
test("academic group entry conflicts retain the existing private registration HTTP error contract", () => {
  expect(
    registrationFailure(
      new RegistrationError("GROUP_CLOSED", "Closed", {
        destinationGroupId: "Reopen",
      }),
    ),
  ).toMatchObject({
    status: 409,
    payload: {
      ok: false,
      code: "GROUP_CLOSED",
      issues: { destinationGroupId: "Reopen" },
    },
  });
});
