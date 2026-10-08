import type { APIContext } from "astro";
import { eq } from "drizzle-orm";
import { requireRoles } from "@/application/auth/authorize";
import { InstructorError } from "@/domain/instructors/profile";
import { requireInternalUser } from "@/server/auth/context";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { readAuthForm } from "@/server/auth/security";
import { getPublicAuthEnvironment } from "@/server/environment";
import { getDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { renameAdminAccount } from "@/application/admin-accounts/manage-admin-accounts";
import { getAdminAccountRepository } from "@/server/admin-accounts/service";
import { AdminAccountError } from "@/domain/admin-accounts/rules";

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
  try {
    const result = await renameAdminAccount(
      getAdminAccountRepository(),
      actor,
      actor.id,
      String(form.get("name") ?? ""),
      String(form.get("revision") ?? ""),
    );
    if (!result.account)
      throw new InstructorError("No se pudo guardar el perfil.");
    return { name: result.account.name, revision: result.account.revision };
  } catch (error) {
    // Preserve the existing profile HTTP/UI contract while sharing the use case.
    if (error instanceof AdminAccountError)
      throw new InstructorError(error.message, error.issues);
    throw error;
  }
}
