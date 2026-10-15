import type { APIRoute } from "astro";
import { handleCourseReportDownload } from "@/server/courses/report-download";
export const GET: APIRoute = (context) => handleCourseReportDownload(context);
