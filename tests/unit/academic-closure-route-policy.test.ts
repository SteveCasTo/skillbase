import { expect, test } from "bun:test";
import { getPrivateRoutePolicy } from "@/server/auth/route-policy";
import { parseClosureVersion } from "@/components/academic-closure/route";

const course = "36c2163d-1789-426c-9cec-36f01dccd112";
const group = "52a52ccf-45ab-4e9b-a1e8-aefbd2be8f23";
for (const [prefix, role] of [
  ["cursos", "ADMIN"],
  ["mis-cursos", "INSTRUCTOR"],
] as const) {
  test(`${role} closure workspace, history and only named downloads have an explicit policy`, () => {
    const base = `/app/${prefix}/${course}/grupos/${group}/cierre`;
    for (const suffix of [
      "",
      "/",
      "/1",
      "/20",
      "/1/planilla.pdf",
      "/1/planilla.csv",
      "/20/informe.pdf",
    ]) {
      expect(getPrivateRoutePolicy(base + suffix)).toEqual({
        access: "ROLES",
        roles: [role],
      });
    }
    for (const suffix of [
      "/0",
      "/-1",
      "/01",
      "/1.5",
      "/version",
      "/1/anything.pdf",
      "/1/informe.csv",
      "/1/planilla.pdf/extra",
      "/reopen",
      "/1/edit",
    ]) {
      expect(getPrivateRoutePolicy(base + suffix)).toBeNull();
    }
    expect(getPrivateRoutePolicy(base.replace(course, "invalid"))).toBeNull();
    expect(getPrivateRoutePolicy(base.replace(group, "invalid"))).toBeNull();
  });
}
test("version parsing rejects ambiguous or unsafe references", () => {
  expect(parseClosureVersion("1")).toBe(1);
  expect(parseClosureVersion("123")).toBe(123);
  for (const version of [
    "0",
    "01",
    "-1",
    "1.0",
    "1e2",
    " 1",
    "9007199254740992",
    "",
  ])
    expect(parseClosureVersion(version)).toBeNull();
});
