import { describe, expect, test } from "bun:test";
import { navigationSkeletonVariant } from "../../src/components/private-nav/navigation-skeleton";

describe("private navigation skeleton structure", () => {
  test("matches only known server-rendered private surfaces", () => {
    expect(navigationSkeletonVariant("/app")).toBe("summary");
    expect(navigationSkeletonVariant("/app/formatos/")).toBe("list");
    expect(navigationSkeletonVariant("/app/cursos")).toBe("list");
    expect(navigationSkeletonVariant("/app/cursos/nuevo")).toBe("form");
    expect(navigationSkeletonVariant("/app/formatos/nuevo")).toBe("form");
    expect(navigationSkeletonVariant("/app/formatos/fixture")).toBe("detail");
    expect(navigationSkeletonVariant("/app/cursos/fixture/editar")).toBe(
      "form",
    );
    expect(navigationSkeletonVariant("/app/cursos/fixture/grupos")).toBe(
      "list",
    );
  });
  test("does not invent structures for public or unknown private routes", () => {
    for (const path of [
      "/",
      "/login",
      "/cursos",
      "/app/unknown",
      "/app/cursos/fixture",
      "/app/formatos/fixture/unknown",
    ]) {
      expect(navigationSkeletonVariant(path)).toBeNull();
    }
  });
});
