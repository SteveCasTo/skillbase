import type { APIRoute } from "astro";
import {
  certificateDownloadRoute,
  certificateMethodNotAllowed,
} from "@/components/certificates/route";
export const GET: APIRoute = (context) =>
  certificateDownloadRoute(context, "SIGNED");
export const ALL: APIRoute = () => certificateMethodNotAllowed("GET");
