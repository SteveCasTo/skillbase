import type { APIContext } from "astro";
import { requireRoles } from "@/application/auth/authorize";
import {
  getInstructor,
  updateInstructor,
} from "@/application/instructors/manage-instructors";
import {
  InstructorError,
  instructorFullName,
  validateInstructor,
} from "@/domain/instructors/profile";
import { requireInternalUser } from "@/server/auth/context";
import { createInstructorAccount } from "@/server/auth/provision-instructor";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { readAuthForm } from "@/server/auth/security";
import { getDatabase } from "@/server/db/client";
import { DrizzleInstructorRepository } from "@/server/db/repositories/instructor-repository";
import { getPublicAuthEnvironment } from "@/server/environment";
import { mutateInstructorLifecycle } from "@/application/instructors/lifecycle";
import { DrizzleInstructorLifecycleRepository } from "@/server/db/repositories/instructor-lifecycle-repository";
import { instructorCredentialRemoval } from "./credential-removal";

type EditorContext = Pick<APIContext, "request" | "locals" | "redirect"> & {
  response: { status?: number };
};
export async function instructorEditor(
  context: EditorContext,
  id?: string,
  own = false,
) {
  const actor = requireInternalUser(context.locals);
  requireRoles(actor, own ? ["INSTRUCTOR"] : ["ADMIN"]);
  if (own && id !== actor.id)
    throw new InstructorError("Perfil no disponible.");
  const repository = new DrizzleInstructorRepository(getDatabase());
  let previous: Awaited<ReturnType<typeof getInstructor>> = null;
  let loadError = false;
  try {
    previous = id
      ? own
        ? await repository.get(actor.id)
        : await getInstructor(repository, actor, id)
      : null;
  } catch {
    loadError = true;
    context.response.status = 503;
  }
  let values: Record<string, string> = previous
    ? {
        firstName: previous.firstName,
        lastName: previous.lastName,
        email: previous.email,
        phone: previous.phone ?? "",
      }
    : {};
  let errors: Readonly<Record<string, string>> = {};
  let error: string | null = loadError
    ? "No se pudo cargar el perfil. Recarga para intentarlo nuevamente."
    : null;
  let revision = previous?.updatedAt.toISOString() ?? "";
  let response: Response | null = null;
  let submittedField: string | undefined;
  if (id && !previous && !loadError) context.response.status = 404;
  if (context.request.method === "POST" && !loadError && (!id || previous)) {
    try {
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
      const intent = form.get("intent");
      if (intent) {
        if (own || !previous)
          throw new InstructorError("La acción no está disponible.");
        await mutateInstructorLifecycle(
          new DrizzleInstructorLifecycleRepository(getDatabase()),
          instructorCredentialRemoval,
          actor,
          previous.id,
          intent,
          form.get("revision") ?? "",
        );
        const destination =
          intent === "delete"
            ? "/app/instructores?success=deleted"
            : `/app/instructores/${previous.id}/editar?success=${intent}`;
        response = context.request.headers
          .get("accept")
          ?.includes("application/json")
          ? new Response(JSON.stringify({ destination }), {
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "private, no-store",
              },
            })
          : context.redirect(destination, 303);
        return {
          values,
          errors,
          error,
          revision,
          response,
          previous,
          submittedField,
        };
      }
      const field = form.get("field");
      if (field !== null) {
        if (!previous || !["firstName", "lastName", "phone"].includes(field))
          throw new InstructorError("El campo no se puede editar.");
        submittedField = field;
        // Merge against the fresh server profile, not client-supplied siblings.
        values = { ...values, [field]: form.get(field) ?? "" };
      } else {
        values = Object.fromEntries(
          ["firstName", "lastName", "email", "phone"].map((key) => [
            key,
            String(form.get(key) ?? ""),
          ]),
        );
      }
      revision = form.get("revision") ?? "";
      const data = validateInstructor({
        ...values,
        ...(previous ? { email: previous.email } : {}),
      });
      let resultId: string;
      if (previous) {
        const updated = await updateInstructor(
          repository,
          actor,
          previous.id,
          values,
          revision,
        );
        resultId = updated.id;
        if (
          submittedField &&
          context.request.headers.get("accept")?.includes("application/json")
        ) {
          response = new Response(
            JSON.stringify({
              revision: updated.updatedAt.toISOString(),
              values: {
                firstName: updated.firstName,
                lastName: updated.lastName,
                email: updated.email,
                phone: updated.phone ?? "",
              },
            }),
            {
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "private, no-store",
              },
            },
          );
          return {
            values,
            errors,
            error,
            revision,
            response,
            previous,
            submittedField,
          };
        }
      } else {
        if (!context.locals.authUser)
          throw new InstructorError("La sesión no está disponible.");
        resultId = (
          await createInstructorAccount(context.locals.authUser.id, {
            email: data.email,
            name: instructorFullName(data),
            password: form.get("password") ?? "",
            profile: data,
          })
        ).id;
      }
      const destination = own
        ? "/app/perfil?status=profile_updated"
        : `/app/instructores/${resultId}/editar?success=saved`;
      response = context.request.headers
        .get("accept")
        ?.includes("application/json")
        ? new Response(JSON.stringify({ destination }), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "private, no-store",
            },
          })
        : context.redirect(destination, 303);
    } catch (cause) {
      if (context.response.status !== 403) context.response.status = 422;
      error =
        cause instanceof InstructorError
          ? cause.message
          : "No pudimos guardar el instructor. Revisa los datos e inténtalo nuevamente.";
      errors = cause instanceof InstructorError ? cause.fieldErrors : {};
      if (context.request.headers.get("accept")?.includes("application/json"))
        response = new Response(
          JSON.stringify({ error, fieldErrors: errors }),
          {
            status: context.response.status ?? 422,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "private, no-store",
            },
          },
        );
    }
  }
  return {
    values,
    errors,
    error,
    revision,
    response,
    previous,
    submittedField,
  };
}
