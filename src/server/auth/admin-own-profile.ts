import type { APIContext } from "astro";
import { and, eq } from "drizzle-orm";
import { requireRoles } from "@/application/auth/authorize";
import { InstructorError } from "@/domain/instructors/profile";
import { requireInternalUser } from "@/server/auth/context";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { readAuthForm } from "@/server/auth/security";
import { getPublicAuthEnvironment } from "@/server/environment";
import { getDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";

type ProfileContext = Pick<APIContext, "request" | "locals"> & {
  response: { status?: number };
};

export async function getAdminOwnProfile(userId: string) {
  const [user] = await getDatabase()
    .select({ name: schema.users.name, updatedAt: schema.users.updatedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return user ?? null;
}

export async function updateAdminOwnName(context: ProfileContext) {
  const actor = requireInternalUser(context.locals);
  requireRoles(actor, ["ADMIN"]);
  if (
    !requestHasExpectedOrigin(
      context.request,
      getPublicAuthEnvironment().siteUrl,
    )
  ) {
    context.response.status = 403;
    throw new InstructorError(
      "Recarga la página antes de enviar la solicitud.",
    );
  }
  const form = await readAuthForm(context.request);
  if (form.get("field") !== "name")
    throw new InstructorError("El campo no se puede editar.");
  const name = String(form.get("name") ?? "").trim();
  // eslint-disable-next-line no-control-regex
  if (!name || name.length > 250 || /[\u0000-\u001f\u007f]/u.test(name))
    throw new InstructorError(
      "Indica un nombre válido de hasta 250 caracteres.",
      {
        name: "Indica un nombre válido de hasta 250 caracteres.",
      },
    );
  const expectedRevision = new Date(String(form.get("revision") ?? ""));
  if (Number.isNaN(expectedRevision.getTime()))
    throw new InstructorError(
      "El perfil cambió. Recarga y revisa antes de guardar.",
    );

  const db = getDatabase();
  const updated = await db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, actor.id))
      .for("update");
    const [adminRole] = await tx
      .select({ userId: schema.userRoles.userId })
      .from(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.userId, actor.id),
          eq(schema.userRoles.roleCode, "ADMIN"),
        ),
      );
    if (!previous || previous.status !== "ACTIVE" || !adminRole)
      throw new InstructorError("El perfil no está disponible.");
    if (previous.updatedAt.getTime() !== expectedRevision.getTime())
      throw new InstructorError(
        "El perfil cambió. Recarga y revisa antes de guardar.",
      );
    const updatedAt = new Date(
      Math.max(Date.now(), previous.updatedAt.getTime() + 1),
    );
    const [result] = await tx
      .update(schema.users)
      .set({ name, updatedAt })
      .where(eq(schema.users.id, actor.id))
      .returning({
        name: schema.users.name,
        updatedAt: schema.users.updatedAt,
      });
    await tx.insert(schema.auditEvents).values({
      actorId: actor.id,
      entityType: "USER",
      entityId: actor.id,
      action: "USER_PROFILE_UPDATED",
      metadata: { fields: "name" },
    });
    if (!result) throw new InstructorError("No se pudo guardar el perfil.");
    return result;
  });
  return { name: updated.name, revision: updated.updatedAt.toISOString() };
}
