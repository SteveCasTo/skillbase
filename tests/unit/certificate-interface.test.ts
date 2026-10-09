import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  hashComparison,
  localPdfError,
  localPdfSha256,
  LOCAL_PDF_MAX_BYTES,
} from "@/components/certificates/local-hash";
import {
  isPublicCertificateDto,
  validCredentialCode,
} from "@/components/certificates/presentation";
import { getPrivateRoutePolicy } from "@/server/auth/route-policy";
import { navigationSkeletonVariant } from "@/components/private-nav/navigation-skeleton";

describe("certificate public verification", () => {
  test("hashes the entire exact PDF locally and detects a single changed byte", async () => {
    const bytes = new TextEncoder().encode(
      "%PDF-1.7\nSynthetic QA PDF bytes\n%%EOF",
    );
    const file = new File([bytes], "synthetic.pdf", {
      type: "application/pdf",
    });
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(await localPdfSha256(file)).toBe(expected);
    const changed = new File([bytes, new Uint8Array([0])], "changed.pdf", {
      type: "application/pdf",
    });
    expect(await localPdfSha256(changed)).not.toBe(expected);
  });
  test("matching revoked or replaced files never become valid", () => {
    const hash = "a".repeat(64);
    expect(hashComparison(hash, hash.toUpperCase(), "issued")).toContain(
      "vigente",
    );
    for (const state of ["revoked", "replaced"])
      expect(hashComparison(hash, hash, state)).toContain("no es válido");
    expect(hashComparison(hash, "b".repeat(64), "issued")).toContain(
      "no coincide",
    );
    expect(hashComparison(hash, "", "not_issued")).toContain(
      "no hay un hash oficial",
    );
  });
  test("bounds local file reads before allocating full bytes", async () => {
    expect(
      localPdfError({
        name: "bad.pdf",
        type: "application/pdf",
        size: LOCAL_PDF_MAX_BYTES + 1,
      }),
    ).toContain("10 MiB");
    expect(
      localPdfError({ name: "photo.jpg", type: "image/jpeg", size: 100 }),
    ).toContain("PDF");
    expect(
      localPdfError({ name: "empty.pdf", type: "application/pdf", size: 0 }),
    ).toContain("contenido");
    await expect(
      localPdfSha256(new File(["data"], "bad.txt", { type: "text/plain" })),
    ).rejects.toThrow("PDF");
  });
  test("requires the bounded opaque public credential code", () => {
    expect(validCredentialCode("a_B-".repeat(8))).toBe(true);
    for (const code of [
      "123",
      "x".repeat(33),
      "../" + "x".repeat(29),
      "<".repeat(32),
    ])
      expect(validCredentialCode(code)).toBe(false);
  });
  test("drafts are minimal and incomplete private-shaped data cannot hydrate verification", () => {
    expect(isPublicCertificateDto({ state: "not_issued", valid: false })).toBe(
      true,
    );
    expect(isPublicCertificateDto({ state: "not_found", valid: false })).toBe(
      true,
    );
    expect(
      isPublicCertificateDto({
        state: "generated",
        data: { recipientName: "Private" },
        signedPath: "private/file.pdf",
      }),
    ).toBe(false);
    expect(
      isPublicCertificateDto({
        state: "issued",
        valid: true,
        signedSha256: "",
      }),
    ).toBe(false);
  });
});

describe("certificate route policy", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  test("ADMIN routes and signed/unsigned delivery are explicit", () => {
    for (const path of [
      "/app/certificados",
      "/app/configuracion/certificados",
      `/app/certificados/${id}`,
      `/app/certificados/${id}/generado.pdf`,
      `/app/certificados/${id}/firmado.pdf`,
      `/app/certificados/${id}/cargar`,
      `/app/cursos/${id}/grupos/${id}/certificados`,
    ])
      expect(getPrivateRoutePolicy(path)).toEqual({
        access: "ROLES",
        roles: ["ADMIN"],
      });
  });
  test("instructor allows only scoped reads; no upload path or unknown suffix is opened", () => {
    for (const path of [
      `/app/mis-certificados/${id}`,
      `/app/mis-certificados/${id}/generado.pdf`,
      `/app/mis-certificados/${id}/firmado.pdf`,
      `/app/mis-cursos/${id}/grupos/${id}/certificados`,
    ])
      expect(getPrivateRoutePolicy(path)).toEqual({
        access: "ROLES",
        roles: ["INSTRUCTOR"],
      });
    for (const path of [
      `/app/mis-certificados/${id}/cargar`,
      `/app/certificados/${id}/eliminar`,
      `/app/certificados/not-a-uuid/firmado.pdf`,
      `/app/cursos/${id}/grupos/not-a-uuid/certificados`,
      `/app/certificados/${id}/firmado.pdf/extra`,
      "/app/mis-certificados",
    ])
      expect(getPrivateRoutePolicy(path)).toBeNull();
  });
  test("navigation skeleton recognizes dedicated certificate surfaces", () => {
    expect(navigationSkeletonVariant("/app/configuracion/certificados")).toBe(
      "form",
    );
    expect(navigationSkeletonVariant(`/app/certificados/${id}`)).toBe("detail");
    expect(
      navigationSkeletonVariant(
        `/app/mis-cursos/${id}/grupos/${id}/certificados`,
      ),
    ).toBe("list");
  });
});
