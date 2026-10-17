import type { APIRoute } from "astro";
import { handlePublicCertificateFilePost } from "@/server/certificates/public-http";
import { getPublicAuthEnvironment } from "@/server/environment";

export const POST: APIRoute = ({ request, clientAddress }) =>
  handlePublicCertificateFilePost({
    request,
    clientAddress,
    siteUrl: getPublicAuthEnvironment().siteUrl,
  });
export const ALL: APIRoute = () =>
  new Response(null, {
    status: 405,
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
