/** Browser orchestration only. Each write remains authorized and validated on the server. */
import { navigate } from "astro:transitions/client";

export function openCreatedCourse(id: string, success: "created" | "updated") {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
    throw new Error(
      "No se pudo abrir el borrador. Abre Cursos para continuar.",
    );
  return navigate(`/app/cursos/${id}/editar?success=${success}`);
}

export async function createCourseWithArtwork(
  fields: FormData,
  image: File,
  onDraft: (url: string, retry: () => Promise<void>) => void,
): Promise<void> {
  const response = await fetch("/app/cursos/nuevo", {
    method: "POST",
    body: fields,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const result: unknown = await response.json();
  if (!response.ok || !isDraft(result))
    throw new Error(
      isError(result) ? formError(result) : "No se pudo crear el borrador.",
    );

  const destination = `/app/cursos/${result.id}/editar`;
  let attached = false;
  const attach = async () => {
    if (attached) {
      await openCreatedCourse(result.id, "updated");
      return;
    }
    const upload = new FormData();
    upload.set("courseId", result.id);
    upload.set("image", image);
    const uploaded = await fetch("/app/cursos/imagen", {
      method: "POST",
      body: upload,
      credentials: "same-origin",
    });
    const body: unknown = await uploaded.json();
    if (!uploaded.ok || !isArtwork(body))
      throw new Error(isError(body) ? body.error : "No se pudo subir la foto.");
    const update = new FormData();
    for (const [key, value] of fields) update.set(key, value);
    update.set("intent", "update");
    update.set("revision", result.revision);
    update.set("artwork", body.artwork);
    const saved = await fetch(destination, {
      method: "POST",
      body: update,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (
      saved.redirected ||
      !saved.headers.get("content-type")?.includes("application/json")
    )
      throw new Error("La sesión cambió. Abre el borrador para continuar.");
    const outcome: unknown = await saved.json();
    if (!saved.ok || !isRevision(outcome))
      throw new Error(
        isMessage(outcome)
          ? outcome.message
          : "No se pudo asociar la foto. Abre el borrador y vuelve a guardarla.",
      );
    attached = true;
    await openCreatedCourse(result.id, "updated");
  };
  onDraft(destination, attach);
  await attach();
}

export function isError(value: unknown): value is { error: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "error" in value &&
    typeof value.error === "string",
  );
}
export function formError(value: { error: string }): string {
  if (
    !("fieldErrors" in value) ||
    !value.fieldErrors ||
    typeof value.fieldErrors !== "object"
  )
    return value.error;
  const messages = Object.values(value.fieldErrors).filter(
    (message): message is string => typeof message === "string",
  );
  return messages.length ? `${value.error} ${messages.join(" ")}` : value.error;
}
function isDraft(value: unknown): value is { id: string; revision: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "revision" in value &&
    typeof value.revision === "string",
  );
}
function isArtwork(value: unknown): value is { artwork: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "artwork" in value &&
    typeof value.artwork === "string",
  );
}
function isRevision(value: unknown): value is { revision: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "revision" in value &&
    typeof value.revision === "string",
  );
}
function isMessage(value: unknown): value is { message: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof value.message === "string",
  );
}
