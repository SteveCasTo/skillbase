import type { APIContext } from "astro";
import {
  loadCourseReport,
  CourseReportError,
  type CourseReportRepository,
} from "@/application/courses/course-report";
import { requireInternalUser } from "@/server/auth/context";
import { getDatabase } from "@/server/db/client";
import { DrizzleCourseReportRepository } from "@/server/db/repositories/course-report-repository";
import { AuthorizationError } from "@/domain/auth/errors";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import { PdfTextError } from "@/server/exports/pdf-text";
import { renderCoursesCsv } from "./exports/csv";
import { renderCoursesPdf } from "./exports/pdf";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const json = (payload: unknown, status: number) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
function singleQuery(params: URLSearchParams, name: string): string | null {
  if (params.getAll(name).length > 1)
    throw new CourseReportError("VALIDATION_FAILED", "No repitas los filtros.");
  return params.get(name);
}

export async function handleCourseReportDownload(
  context: Pick<APIContext, "request" | "locals">,
  repository?: CourseReportRepository,
): Promise<Response> {
  try {
    if (!context.locals.internalUser)
      return json(
        {
          ok: false,
          code: "UNAUTHENTICATED",
          message: "Inicia sesión para descargar el informe.",
        },
        401,
      );
    const user = requireInternalUser(context.locals);
    const params = new URL(context.request.url).searchParams;
    const format = singleQuery(params, "format");
    if (format !== "CSV" && format !== "PDF")
      throw new CourseReportError("VALIDATION_FAILED", "Selecciona CSV o PDF.");
    const report = await loadCourseReport(
      repository ?? new DrizzleCourseReportRepository(getDatabase()),
      user,
      {
        search: singleQuery(params, "search"),
        status: singleQuery(params, "status"),
      },
    );
    const bytes =
      format === "CSV"
        ? renderCoursesCsv(report)
        : await renderCoursesPdf(report);
    const filename = `cursos-${instantToBoliviaCivil(report.generatedAt).slice(0, 10)}.${format.toLowerCase()}`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type":
          format === "CSV" ? "text/csv; charset=utf-8" : "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Course-Count": String(report.courses.length),
        "X-Group-Count": String(report.groupCount),
      },
    });
  } catch (error) {
    if (error instanceof CourseReportError || error instanceof PdfTextError)
      return json(
        { ok: false, code: error.code, message: error.message },
        error.code === "VALIDATION_FAILED" ? 422 : 409,
      );
    if (
      error instanceof AuthorizationError ||
      (error instanceof RegistrationError && error.code === "FORBIDDEN")
    )
      return json(
        {
          ok: false,
          code: "FORBIDDEN",
          message: "No tienes permiso para descargar este informe.",
        },
        403,
      );
    return json(
      {
        ok: false,
        code: "SERVICE_UNAVAILABLE",
        message:
          "No se pudo preparar el informe. Conserva los filtros e inténtalo nuevamente.",
      },
      503,
    );
  }
}
