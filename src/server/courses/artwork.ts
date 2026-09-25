import { createClient } from "@supabase/supabase-js";

import type { InternalUser } from "@/domain/auth/types";
import { requireRoles } from "@/application/auth/authorize";

export const COURSE_ARTWORK_BUCKET = "course-artwork";
export const COURSE_ARTWORK_MAX_BYTES = 4 * 1024 * 1024;
const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const KEY = new RegExp(`^courses/(${UUID})/(${UUID})\\.webp$`, "i");

export class ArtworkValidationError extends Error {}

export function artworkKeyForCourse(courseId: string, key: string): boolean {
  const match = KEY.exec(key);
  return Boolean(match && match[1]?.toLowerCase() === courseId.toLowerCase());
}

// Only canonical keys in our public bucket are ever turned into a URL. Never render
// client-supplied URLs, other buckets, or legacy/unknown values as an image source.
export function publicArtworkUrl(
  key: string | null | undefined,
  supabaseUrl: string,
): string | null {
  if (!key || !KEY.test(key)) return null;
  const url = new URL(supabaseUrl);
  if (!["http:", "https:"].includes(url.protocol)) return null;
  return `${url.origin}/storage/v1/object/public/${COURSE_ARTWORK_BUCKET}/${key}`;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 30)
    throw new ArtworkValidationError("Imagen WebP inválida.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  if (
    text(0, 4) !== "RIFF" ||
    text(8, 4) !== "WEBP" ||
    view.getUint32(4, true) !== bytes.length - 8
  )
    throw new ArtworkValidationError("Imagen WebP inválida.");
  const chunk = text(12, 4);
  const size = view.getUint32(16, true);
  if (size < 10 || 20 + size + (size % 2) !== bytes.length)
    throw new ArtworkValidationError("Imagen WebP inválida.");
  if (chunk === "VP8 " && text(23, 3) === "\x9d\x01\x2a") {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    return {
      width: 1 + (bytes[21]! | ((bytes[22]! & 0x3f) << 8)),
      height:
        1 +
        ((bytes[22]! >> 6) | (bytes[23]! << 2) | ((bytes[24]! & 0x0f) << 10)),
    };
  }
  // No animated or extended metadata containers: the canvas export produces
  // simple VP8/VP8L, stripping EXIF and author-supplied metadata.
  throw new ArtworkValidationError(
    "La imagen debe ser una foto WebP sin animación.",
  );
}

export async function validateArtwork(file: File): Promise<Uint8Array> {
  if (file.type !== "image/webp" || !/\.webp$/i.test(file.name))
    throw new ArtworkValidationError("Selecciona una imagen WebP recortada.");
  if (!file.size || file.size > COURSE_ARTWORK_MAX_BYTES)
    throw new ArtworkValidationError("La imagen no puede superar 4 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { width, height } = webpDimensions(bytes);
  if (
    width < 400 ||
    height < 250 ||
    width > 4096 ||
    height > 4096 ||
    width * height > 8_000_000
  )
    throw new ArtworkValidationError(
      "La imagen debe medir entre 400 × 250 y 4096 × 4096 píxeles.",
    );
  return bytes;
}

export function requireArtworkAdmin(user: InternalUser): void {
  if (user.status !== "ACTIVE")
    throw new ArtworkValidationError("Acceso no autorizado.");
  requireRoles(user, ["ADMIN"]);
}

export function artworkStorage() {
  // Only the server receives this credential. Never send it to Astro props or
  // browser code; Storage RLS intentionally grants no direct client uploads.
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  if (!secret || !url)
    throw new Error("Course artwork Storage is not configured");
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
}

type Storage = ReturnType<typeof artworkStorage>;

export async function ensureArtworkBucket(storage: Storage): Promise<void> {
  const { data, error } = await storage.getBucket(COURSE_ARTWORK_BUCKET);
  if (error || !data) {
    // Create-on-demand is used instead of a Drizzle migration: Storage bucket
    // configuration is reproducible in local and cloud with the same runtime.
    const created = await storage.createBucket(COURSE_ARTWORK_BUCKET, {
      public: true,
      allowedMimeTypes: ["image/webp"],
      fileSizeLimit: COURSE_ARTWORK_MAX_BYTES,
    });
    if (created.error) {
      // A concurrent request may have won the creation race; re-check below.
      const retry = await storage.getBucket(COURSE_ARTWORK_BUCKET);
      if (retry.error || !retry.data) throw created.error;
      assertBucket(retry.data);
      return;
    }
    return;
  }
  assertBucket(data);
}

function assertBucket(bucket: {
  public: boolean;
  allowed_mime_types?: string[] | null;
  file_size_limit?: number | null;
}): void {
  if (
    !bucket.public ||
    bucket.file_size_limit !== COURSE_ARTWORK_MAX_BYTES ||
    bucket.allowed_mime_types?.length !== 1 ||
    bucket.allowed_mime_types[0] !== "image/webp"
  )
    throw new Error("Course artwork bucket has unexpected security settings");
}

export async function uploadArtwork(
  courseId: string,
  bytes: Uint8Array,
  storage: Storage,
): Promise<string> {
  await ensureArtworkBucket(storage);
  const key = `courses/${courseId}/${crypto.randomUUID()}.webp`;
  const result = await storage.from(COURSE_ARTWORK_BUCKET).upload(key, bytes, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (result.error) throw result.error;
  return key;
}

// Call this in the admin save use case, not in the browser. The key must be for
// the course being edited AND already exist in the controlled bucket.
export async function verifyArtworkForCourse(
  courseId: string,
  key: string,
  storage: Storage,
): Promise<void> {
  if (!artworkKeyForCourse(courseId, key))
    throw new ArtworkValidationError("Imagen del curso inválida.");
  const segments = key.split("/");
  const result = await storage
    .from(COURSE_ARTWORK_BUCKET)
    .info(`${segments[0]}/${segments[1]}/${segments[2]}`);
  if (result.error || !result.data || result.data.contentType !== "image/webp")
    throw new ArtworkValidationError(
      "La imagen ya no está disponible. Vuelve a cargarla.",
    );
}
