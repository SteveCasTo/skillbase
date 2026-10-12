import type { APIRoute } from "astro";
import { requireInternalUser } from "@/server/auth/context";
import { getCertificateRepository } from "@/server/certificates/service";
import { previewCertificate } from "@/server/certificates/preview";
export const GET: APIRoute = (context) =>
  previewCertificate(
    requireInternalUser(context.locals),
    context.url.searchParams.get("type"),
    getCertificateRepository(),
  );
