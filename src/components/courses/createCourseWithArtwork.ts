/** Browser orchestration only. Each write remains authorized and validated on the server. */
import { navigate } from "astro:transitions/client";
import {
  isRevision as validRevision,
  isUuid,
  isCourseSaveResult,
} from "@/domain/courses/mutation-result";

export class DefinitiveCreateError extends Error {}

export function openCreatedCourse(id: string, groups = false) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
    throw new Error(
      "No se pudo abrir el borrador. Abre Cursos para continuar.",
    );
  return navigate(`/app/cursos/${id}/${groups ? "grupos" : "editar"}`);
}

export interface InitialGroup {
  readonly startTime: string;
  readonly capacity: number;
}

export async function createCourseWithArtwork(
  fields: FormData,
  image: File | null,
  groups: readonly InitialGroup[],
  onDraft: (url: string, retry: () => Promise<void>) => void,
): Promise<void> {
  const response = await fetch("/app/cursos/nuevo", {
    method: "POST",
    body: fields,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (
    response.redirected ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error(
      "La sesión cambió. Recarga la página e inténtalo de nuevo.",
    );
  const result: unknown = await response.json();
  if (!response.ok || !isDraft(result))
    throw new (
      response.status >= 400 && response.status < 500
        ? DefinitiveCreateError
        : Error
    )(isError(result) ? formError(result) : "No se pudo crear el borrador.");

  const destination = `/app/cursos/${result.id}/editar`;
  let attached = !image;
  let nextGroup = 0;
  let uploadedKey: string | null = null;
  let uncertainGroup = false;
  let pending = false;
  let associationAttempted = false;
  let revision = result.revision;
  const groupPath = `/app/cursos/${result.id}/grupos`;
  const groupAlreadyExists = async (group: InitialGroup): Promise<boolean> => {
    const response = await fetch(groupPath, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (
      !response.ok ||
      response.redirected ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      throw new Error(
        "No se pudo verificar el grupo. Abre el borrador para continuar.",
      );
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("groups" in body) ||
      !Array.isArray(body.groups)
    )
      throw new Error(
        "No se pudo verificar el grupo. Abre el borrador para continuar.",
      );
    return body.groups.some(
      (existing: unknown) =>
        existing !== null &&
        typeof existing === "object" &&
        "id" in existing &&
        "revision" in existing &&
        validCreatedGroup(
          { id: existing.id, revision: existing.revision, group: existing },
          group,
        ) &&
        "startTime" in existing &&
        existing.startTime === group.startTime &&
        "capacity" in existing &&
        existing.capacity === group.capacity &&
        "status" in existing &&
        existing.status === "PLANNED",
    );
  };
  const attach = async () => {
    if (pending) return;
    pending = true;
    try {
      if (!attached && image) {
        if (!uploadedKey) {
          const upload = new FormData();
          upload.set("courseId", result.id);
          upload.set("image", image);
          const uploaded = await fetch("/app/cursos/imagen", {
            method: "POST",
            body: upload,
            credentials: "same-origin",
          });
          if (
            uploaded.redirected ||
            !uploaded.headers.get("content-type")?.includes("application/json")
          )
            throw new Error(
              "La sesión cambió. Abre el borrador para continuar.",
            );
          const body: unknown = await uploaded.json();
          if (!uploaded.ok || !isArtwork(body))
            throw new Error(
              isError(body) ? body.error : "No se pudo subir la foto.",
            );
          uploadedKey = body.artwork;
        }
        if (
          !uploadedKey.startsWith(`courses/${result.id}/`) ||
          !uploadedKey.endsWith(".webp") ||
          !isUuid(uploadedKey.slice(`courses/${result.id}/`.length, -5))
        )
          throw new Error("La foto recibida no pertenece al borrador.");
        if (associationAttempted) {
          const response = await fetch(destination, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          });
          if (
            !response.ok ||
            response.redirected ||
            !response.headers.get("content-type")?.includes("application/json")
          )
            throw new Error(
              "No se pudo verificar la foto. Abre el borrador para continuar.",
            );
          const persisted: unknown = await response.json();
          if (
            !isDraft(persisted) ||
            persisted.id !== result.id ||
            !("artwork" in persisted)
          )
            throw new Error("No se pudo verificar la foto del borrador.");
          if (persisted.artwork === uploadedKey) {
            attached = true;
            revision = persisted.revision;
          } else if (persisted.revision !== revision)
            throw new Error(
              "El borrador cambió. Ábrelo y revisa la foto antes de continuar.",
            );
        }
        if (!attached) {
          const update = new FormData();
          for (const [key, value] of fields) update.set(key, value);
          update.set("intent", "update");
          update.set("revision", revision);
          update.set("artwork", uploadedKey);
          associationAttempted = true;
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
            throw new Error(
              "La sesión cambió. Abre el borrador para continuar.",
            );
          const outcome: unknown = await saved.json();
          if (!saved.ok || !isCourseSaveResult(outcome))
            throw new Error(
              isMessage(outcome)
                ? outcome.message
                : "No se pudo asociar la foto. Abre el borrador y vuelve a guardarla.",
            );
          attached = true;
          revision = outcome.revision;
        }
      }
      for (; nextGroup < groups.length; nextGroup++) {
        const group = groups[nextGroup]!;
        if (uncertainGroup) {
          if (await groupAlreadyExists(group)) {
            uncertainGroup = false;
            continue;
          }
          uncertainGroup = false;
        }
        const data = new FormData();
        data.set("intent", "create");
        data.set("startTime", group.startTime);
        data.set("capacity", String(group.capacity));
        try {
          const response = await fetch(groupPath, {
            method: "POST",
            body: data,
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          });
          if (
            response.redirected ||
            !response.headers.get("content-type")?.includes("application/json")
          )
            throw new Error(
              "La sesión cambió. Abre el borrador para continuar.",
            );
          const outcome: unknown = await response.json();
          if (!response.ok || !validCreatedGroup(outcome, group))
            throw new Error(
              isMessage(outcome)
                ? outcome.message
                : `No se pudo crear el grupo ${nextGroup + 1}. Abre el borrador para continuar.`,
            );
        } catch (error) {
          uncertainGroup = true;
          throw error;
        }
      }
      await openCreatedCourse(result.id, groups.length > 0);
    } finally {
      pending = false;
    }
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
    isUuid(value.id) &&
    "revision" in value &&
    validRevision(value.revision),
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
function isMessage(value: unknown): value is { message: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof value.message === "string",
  );
}

function validCreatedGroup(value: unknown, expected: InitialGroup): boolean {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    !isUuid(value.id) ||
    !("revision" in value) ||
    !validRevision(value.revision) ||
    !("group" in value) ||
    !value.group ||
    typeof value.group !== "object"
  )
    return false;
  const group = value.group;
  return (
    "id" in group &&
    group.id === value.id &&
    "revision" in group &&
    group.revision === value.revision &&
    "startTime" in group &&
    group.startTime === expected.startTime &&
    typeof group.startTime === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(group.startTime) &&
    "capacity" in group &&
    group.capacity === expected.capacity &&
    Number.isInteger(group.capacity) &&
    group.capacity > 0 &&
    group.capacity <= 2147483647 &&
    "status" in group &&
    group.status === "PLANNED" &&
    "published" in group &&
    typeof group.published === "boolean" &&
    "endTime" in group &&
    typeof group.endTime === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(group.endTime)
  );
}
