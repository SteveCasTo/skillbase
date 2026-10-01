import { expect, test } from "bun:test";
import {
  validateInstructor,
  instructorFullName,
} from "@/domain/instructors/profile";
import { instructorSchedulesOverlap } from "@/domain/instructors/schedule";
import { boliviaCivilToInstant } from "@/domain/courses/bolivia-time";
import { getPrivateRoutePolicy } from "@/server/auth/route-policy";
import { assertInstructorChange } from "@/domain/instructors/assignment";

test("official Bolivia start boundary is strict; same-instructor edits are not reassignment", () => {
  const start = boliviaCivilToInstant("2027-03-01T00:00");
  expect(() =>
    assertInstructorChange(
      "old",
      "new",
      start,
      new Date("2027-03-01T03:59:59.999Z"),
    ),
  ).not.toThrow();
  expect(() =>
    assertInstructorChange(
      "old",
      "new",
      start,
      new Date("2027-03-01T04:00:00.000Z"),
    ),
  ).toThrow();
  expect(() =>
    assertInstructorChange(
      "old",
      "old",
      start,
      new Date("2027-03-01T04:00:00.001Z"),
    ),
  ).not.toThrow();
});

test("profile normalizes names and email without collecting public contact or description", () => {
  const profile = validateInstructor({
    firstName: " Ana ",
    lastName: " Pérez ",
    email: " ANA@EXAMPLE.TEST ",
    phone: " +591 70000000 ",
  });
  expect(profile).toEqual({
    firstName: "Ana",
    lastName: "Pérez",
    email: "ana@example.test",
    phone: "+591 70000000",
  });
  expect(instructorFullName(profile)).toBe("Ana Pérez");
  expect(
    validateInstructor({
      firstName: "Ana",
      lastName: "Pérez",
      email: "ana@example.test",
    }).phone,
  ).toBeNull();
});
test("profile independently rejects missing, oversized, malformed and control-bearing fields", () => {
  const valid = {
    firstName: "Ana",
    lastName: "Pérez",
    email: "ana@example.test",
  };
  for (const input of [
    { firstName: " " },
    { firstName: "a".repeat(101) },
    { lastName: "a".repeat(151) },
    { lastName: "x\ny" },
    { email: "wrong" },
    { phone: "a".repeat(33) },
  ])
    expect(() => validateInstructor({ ...valid, ...input })).toThrow();
});
const schedule = (
  first: string,
  last: string,
  start = "08:00",
  end = "09:30",
) => ({
  startsAt: boliviaCivilToInstant(`${first}T${start}`),
  endsAt: boliviaCivilToInstant(`${last}T${end}`),
});
test("recurring conflicts intersect civil dates and half-open hours, including weekend-only intersections", () => {
  const a = schedule("2027-03-01", "2027-03-05");
  expect(
    instructorSchedulesOverlap(
      a,
      schedule("2027-03-05", "2027-03-10", "09:00", "10:30"),
    ),
  ).toBe(true);
  expect(
    instructorSchedulesOverlap(
      a,
      schedule("2027-03-05", "2027-03-10", "09:30", "11:00"),
    ),
  ).toBe(false);
  expect(
    instructorSchedulesOverlap(a, schedule("2027-03-08", "2027-03-12")),
  ).toBe(false);
  expect(
    instructorSchedulesOverlap(
      schedule("2027-03-05", "2027-03-07"),
      schedule("2027-03-06", "2027-03-08"),
    ),
  ).toBe(false);
});
test("instructor routes remain read-specific and admin mutation URLs never widen", () => {
  const id = crypto.randomUUID();
  expect(getPrivateRoutePolicy(`/app/mis-cursos/${id}`)).toEqual({
    access: "ROLES",
    roles: ["INSTRUCTOR"],
  });
  expect(getPrivateRoutePolicy(`/app/cursos/${id}/editar`)).toEqual({
    access: "ROLES",
    roles: ["ADMIN"],
  });
  expect(getPrivateRoutePolicy(`/app/instructores/${id}/editar`)).toEqual({
    access: "ROLES",
    roles: ["ADMIN"],
  });
  expect(getPrivateRoutePolicy(`/app/mis-cursos/${id}/editar`)).toBeNull();
  expect(getPrivateRoutePolicy("/app/asistencia")).toBeNull();
});
