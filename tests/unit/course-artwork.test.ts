import { describe, expect, test } from "bun:test";

import {
  ArtworkValidationError,
  artworkKeyForCourse,
  publicArtworkUrl,
  requireArtworkAdmin,
  validateArtwork,
} from "../../src/server/courses/artwork";

const course = "123e4567-e89b-42d3-a456-426614174000";
const image = "c2a1c618-72a6-44ae-a654-220ddb848511";
const key = `courses/${course}/${image}.webp`;

function sampleWebp(width = 1200, height = 750) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  for (const [offset, text] of [
    [0, "RIFF"],
    [8, "WEBP"],
    [12, "VP8 "],
  ] as const)
    for (let i = 0; i < text.length; i++)
      bytes[offset + i] = text.charCodeAt(i);
  view.setUint32(4, 22, true);
  view.setUint32(16, 10, true);
  bytes.set([0x9d, 0x01, 0x2a], 23);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return bytes;
}

describe("course artwork", () => {
  test("requires an active admin independently of middleware", () => {
    const user = {
      id: course,
      authUserId: course,
      email: "admin@example.test",
      name: "Test",
      status: "ACTIVE" as const,
      roles: ["ADMIN" as const],
    };
    expect(() => requireArtworkAdmin(user)).not.toThrow();
    expect(() =>
      requireArtworkAdmin({ ...user, roles: ["INSTRUCTOR"] }),
    ).toThrow();
    expect(() =>
      requireArtworkAdmin({ ...user, status: "DISABLED" }),
    ).toThrow();
  });
  test("renders only canonical public keys and binds uploaded keys to their course", () => {
    expect(artworkKeyForCourse(course, key)).toBe(true);
    expect(
      artworkKeyForCourse("123e4567-e89b-42d3-a456-426614174001", key),
    ).toBe(false);
    expect(publicArtworkUrl(key, "https://example.supabase.co")).toBe(
      `https://example.supabase.co/storage/v1/object/public/course-artwork/${key}`,
    );
    for (const forged of [
      "https://evil.test/image.webp",
      "../secret.webp",
      `${key}?download=1`,
      `${key}/extra`,
      "courses/other/photo.webp",
    ])
      expect(
        publicArtworkUrl(forged, "https://example.supabase.co"),
      ).toBeNull();
  });

  test("accepts a properly sized WebP with matching MIME and extension", async () => {
    expect(
      await validateArtwork(
        new File([sampleWebp()], "crop.webp", { type: "image/webp" }),
      ),
    ).toHaveLength(30);
  });

  test("rejects forged MIME, corrupt headers, animation and extreme dimensions", async () => {
    const valid = sampleWebp();
    const cases = [
      new File([valid], "crop.svg", { type: "image/webp" }),
      new File([valid], "crop.webp", { type: "image/png" }),
      new File([new Uint8Array(30)], "crop.webp", { type: "image/webp" }),
      new File([sampleWebp(200, 100)], "crop.webp", { type: "image/webp" }),
      new File([sampleWebp(5000, 750)], "crop.webp", { type: "image/webp" }),
      new File([new Uint8Array(4 * 1024 * 1024 + 1)], "crop.webp", {
        type: "image/webp",
      }),
    ];
    const animated = sampleWebp();
    animated.set([86, 80, 56, 56], 12); // VP8X
    cases.push(new File([animated], "crop.webp", { type: "image/webp" }));
    for (const file of cases) {
      try {
        await validateArtwork(file);
        throw new Error("Invalid image was accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(ArtworkValidationError);
      }
    }
  });
});
