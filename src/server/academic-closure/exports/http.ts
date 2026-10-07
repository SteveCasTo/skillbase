import type { APIContext, APIRoute } from "astro";
import type { ClosureRepository } from "@/application/academic-closure/closure-repository";
import { ClosureError } from "@/domain/academic-closure/rules";
import {
  closureFailure,
  closureHeaders,
  closureJson,
} from "@/server/academic-closure/http";
import { loadAcademicClosureVersion } from "@/server/academic-closure/loaders";
import { renderClosureCsv } from "./csv";
import { ClosureExportError } from "./document";
import { renderClosurePdf } from "./pdf";
import { RegistrationPdfTextError } from "@/server/pre-registrations/exports/pdf";

export type ClosureDownload = "planilla.pdf" | "planilla.csv" | "informe.pdf";
export function parseClosureVersion(value: string | undefined): number {
  if (
    !value ||
    !/^[1-9]\d*$/u.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new ClosureError("VALIDATION_FAILED", "Versión no válida.");
  return Number(value);
}
/** Fixed route role is a defense in depth; projection still derives from fresh DB roles. */
export async function handleClosureDownload(
  context: Pick<APIContext, "locals" | "params">,
  artifact: ClosureDownload,
  requiredRole: "ADMIN" | "INSTRUCTOR",
  repository?: ClosureRepository,
): Promise<Response> {
  const actor = context.locals.internalUser;
  if (!actor)
    return closureJson(
      {
        ok: false,
        code: "UNAUTHENTICATED",
        message: "Inicia sesión para descargar el documento.",
        issues: {},
      },
      401,
    );
  try {
    if (actor.status !== "ACTIVE" || !actor.roles.includes(requiredRole))
      throw new ClosureError(
        "FORBIDDEN",
        "La cuenta no tiene autorización vigente.",
      );
    const courseId = context.params.id ?? "",
      groupId = context.params.groupId ?? "";
    const version = parseClosureVersion(context.params.version);
    const result = await loadAcademicClosureVersion({
      actor,
      courseId,
      groupId,
      version,
      ...(repository ? { repository } : {}),
    });
    if (!result.available)
      return closureJson(
        {
          ok: false,
          code: result.code,
          message: result.unavailableReason,
          issues: {},
        },
        result.status,
      );
    if (requiredRole === "ADMIN" && result.data.report.access !== "ADMIN")
      throw new ClosureError(
        "FORBIDDEN",
        "La cuenta no tiene autorización vigente.",
      );
    // Reject a corrupt/mismatched repository response rather than label it as another context/version.
    if (
      result.data.version !== version ||
      result.data.report.courseId !== courseId.toLowerCase() ||
      result.data.report.groupId !== groupId.toLowerCase()
    )
      throw new ClosureExportError();
    const csv = artifact === "planilla.csv";
    const bytes = csv
      ? renderClosureCsv(result.data)
      : await renderClosurePdf(
          result.data,
          artifact === "informe.pdf" ? "informe" : "planilla",
        );
    // Only validated numeric version and fixed constants enter headers; no user-supplied names/paths.
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...closureHeaders,
        "Content-Type": csv ? "text/csv; charset=utf-8" : "application/pdf",
        "Content-Disposition": `attachment; filename="cierre-v${version}-${artifact}"`,
      },
    });
  } catch (error) {
    if (
      error instanceof ClosureExportError ||
      error instanceof RegistrationPdfTextError
    )
      return closureJson(
        {
          ok: false,
          code:
            error instanceof RegistrationPdfTextError
              ? error.code
              : "INVALID_CLOSURE_EVIDENCE",
          message: error.message,
          issues: {},
        },
        409,
      );
    const failure = closureFailure(error);
    return closureJson(failure.payload, failure.status);
  }
}
export function closureDownloadRoute(
  artifact: ClosureDownload,
  requiredRole: "ADMIN" | "INSTRUCTOR",
): APIRoute {
  return (context) => handleClosureDownload(context, artifact, requiredRole);
}
