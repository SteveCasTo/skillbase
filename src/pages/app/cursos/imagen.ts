import type { APIRoute } from "astro";

import { getAdminCourse } from "@/application/courses/manage-courses";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { requireInternalUser } from "@/server/auth/context";
import {
  ArtworkValidationError,
  artworkStorage,
  requireArtworkAdmin,
  uploadArtwork,
  validateArtwork,
} from "@/server/courses/artwork";
import { getDatabase } from "@/server/db/client";
import { DrizzleCourseRepository } from "@/server/db/repositories/course-repository";
import { getPublicAuthEnvironment } from "@/server/environment";

export const prerender = false;

const json = (value: object, status: number) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });

async function boundedFormData(request: Request): Promise<FormData | null> {
  const limit = 5 * 1024 * 1024;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const body = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    body: body.buffer,
  }).formData();
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!requestHasExpectedOrigin(request, getPublicAuthEnvironment().siteUrl))
    return json({ error: "Origen no permitido." }, 403);
  try {
    const user = requireInternalUser(locals);
    requireArtworkAdmin(user);
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("multipart/form-data;")
    )
      return json({ error: "Formulario inválido." }, 400);
    const declaredSize = Number(request.headers.get("content-length"));
    if (declaredSize > 5 * 1024 * 1024)
      return json({ error: "Imagen demasiado grande." }, 413);
    const form = await boundedFormData(request);
    if (!form)
      return json(
        { error: "Imagen demasiado grande o formulario vacío." },
        413,
      );
    const courseId = form.get("courseId");
    const file = form.get("image");
    if (
      typeof courseId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        courseId,
      ) ||
      !(file instanceof File)
    )
      return json({ error: "Imagen o curso inválido." }, 400);
    const course = await getAdminCourse(
      new DrizzleCourseRepository(getDatabase()),
      user,
      courseId,
    );
    if (!course || course.status === "ARCHIVED")
      return json({ error: "Curso no disponible." }, 404);
    const bytes = await validateArtwork(file);
    const key = await uploadArtwork(courseId, bytes, artworkStorage());
    return json({ artwork: key }, 201);
  } catch (error) {
    if (error instanceof ArtworkValidationError)
      return json({ error: error.message }, 400);
    // Never leak Storage responses, credentials or object paths to the browser.
    return json(
      { error: "No se pudo guardar la imagen. Inténtalo de nuevo." },
      500,
    );
  }
};
