import { getDatabase } from "@/server/db/client";
import { DrizzleCertificateRepository } from "@/server/db/repositories/certificate-repository";
import { ManageCertificates } from "@/application/certificates/manage-certificates";
import type {
  CertificatePdfRenderer,
  CertificateStorage,
} from "@/application/certificates/types";
import { validateCertificatePdf } from "./upload";
import { createClient } from "@supabase/supabase-js";
import { getPublicAuthEnvironment } from "@/server/environment";
import { SupabaseCertificateStorage } from "./storage";
import { createCertificatePdfRenderer } from "./renderer";
export const getCertificateRepository = () =>
  new DrizzleCertificateRepository(getDatabase());
/** Production composition supplies the separately owned real PDF adapter. */
export const createCertificateService = (
  renderer: CertificatePdfRenderer,
  storage: CertificateStorage,
  verificationOrigin: string,
) =>
  new ManageCertificates(
    getCertificateRepository(),
    storage,
    {
      async render(data) {
        const bytes = await renderer.render(data);
        await validateCertificatePdf(
          bytes,
          "generated.pdf",
          "application/pdf",
          "UNSIGNED",
        );
        return bytes;
      },
    },
    verificationOrigin,
  );
/** Fully integrated production composition; only invoked from authorized server adapters. */
export function getCertificateService() {
  const environment = getPublicAuthEnvironment();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("Certificate private Storage is unavailable");
  const client = createClient(environment.supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return createCertificateService(
    createCertificatePdfRenderer(),
    new SupabaseCertificateStorage(client),
    environment.siteUrl.origin,
  );
}
