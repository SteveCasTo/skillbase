import type { APIRoute } from "astro";
import {
  certificateUploadRoute,
  certificateMethodNotAllowed,
} from "@/components/certificates/route";
export const POST: APIRoute = certificateUploadRoute;
export const ALL: APIRoute = () => certificateMethodNotAllowed("POST");
