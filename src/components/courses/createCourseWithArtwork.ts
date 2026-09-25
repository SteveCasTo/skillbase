/** Browser orchestration only. Each write remains authorized and validated on the server. */
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
  const attach = async () => {
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
    });
    // Browsers expose manual redirects as opaque responses (status 0).
    // Follow the PRG redirect and verify its final same-origin destination.
    if (
      !saved.ok ||
      !saved.redirected ||
      new URL(saved.url).pathname !== destination
    )
      throw new Error(
        "No se pudo asociar la foto. Abre el borrador y vuelve a guardarla.",
      );
    window.location.assign(`${destination}?success=updated`);
  };
  onDraft(destination, attach);
  await attach();
}

function isError(value: unknown): value is { error: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "error" in value &&
    typeof value.error === "string",
  );
}
function formError(value: { error: string }): string {
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
