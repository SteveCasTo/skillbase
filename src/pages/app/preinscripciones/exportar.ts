import type { APIRoute } from "astro";
import { requireInternalUser } from "@/server/auth/context";
import { exportRegistrations } from "@/application/pre-registrations/export-registrations";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";
import { createRegistrationExportPort } from "@/server/pre-registrations/exports";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import {
  parseRegistrationFilter,
  registrationFailure,
  registrationHeaders,
  registrationJson,
  singleQuery,
} from "@/server/pre-registrations/http";
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const params = new URL(request.url).searchParams;
    const format = singleQuery(params, "format");
    if (format !== "CSV" && format !== "PDF")
      throw new RegistrationError("VALIDATION_FAILED", "Selecciona CSV o PDF.");
    const artifact = await exportRegistrations(
      createRegistrationRepository(),
      createRegistrationExportPort(),
      requireInternalUser(locals),
      { filter: parseRegistrationFilter(params), format },
    );
    return new Response(new Uint8Array(artifact.bytes), {
      headers: {
        ...registrationHeaders,
        "Content-Type": artifact.mediaType,
        "Content-Disposition": `attachment; filename="${artifact.filename}"`,
        "X-Registration-Row-Count": String(artifact.rowCount),
      },
    });
  } catch (error) {
    const failure = registrationFailure(error);
    return registrationJson(failure.payload, failure.status);
  }
};
