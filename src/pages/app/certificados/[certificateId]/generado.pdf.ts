import type { APIRoute } from "astro";
import {
  certificateDownloadRoute,
  certificateMethodNotAllowed,
  certificatePrepareDownloadRoute,
} from "@/components/certificates/route";
export const GET: APIRoute = (context) =>
  certificateDownloadRoute(context, "UNSIGNED");
export const POST: APIRoute = certificatePrepareDownloadRoute;
export const ALL: APIRoute = () => certificateMethodNotAllowed("GET, POST");
