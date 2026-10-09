import type { SupabaseClient } from "@supabase/supabase-js";
import type { CertificateStorage } from "@/application/certificates/types";
import { CERTIFICATE_PDF_MAX_BYTES } from "./upload";
export const CERTIFICATE_BUCKET = "certificate-documents";
export class SupabaseCertificateStorage implements CertificateStorage {
  constructor(private readonly client: SupabaseClient) {}
  private async bucket() {
    const { data, error } =
      await this.client.storage.getBucket(CERTIFICATE_BUCKET);
    if (error) throw new Error("Certificate private bucket unavailable");
    if (!data || data.public)
      throw new Error("Certificate bucket must be private");
    return this.client.storage.from(CERTIFICATE_BUCKET);
  }
  /** Explicit provisioning by an authorized server operator, never on anonymous verification. */
  async provision() {
    const existing = await this.client.storage.getBucket(CERTIFICATE_BUCKET);
    if (existing.data) {
      if (existing.data.public)
        throw new Error("Certificate bucket must be private");
      return;
    }
    if (
      existing.error &&
      !["404", "400"].includes(String(existing.error.status))
    )
      throw new Error("Certificate bucket lookup failed");
    const { error } = await this.client.storage.createBucket(
      CERTIFICATE_BUCKET,
      {
        public: false,
        allowedMimeTypes: ["application/pdf"],
        fileSizeLimit: CERTIFICATE_PDF_MAX_BYTES,
      },
    );
    if (error) throw new Error("Certificate bucket provisioning failed");
  }
  async put(path: string, bytes: Uint8Array) {
    const bucket = await this.bucket();
    const { error } = await bucket.upload(path, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (error) throw new Error("Certificate upload failed");
  }
  async get(path: string) {
    const bucket = await this.bucket();
    const { data, error } = await bucket.download(path);
    if (error || !data) throw new Error("Certificate download failed");
    return new Uint8Array(await data.arrayBuffer());
  }
  async remove(path: string) {
    const bucket = await this.bucket();
    const { error } = await bucket.remove([path]);
    if (error) throw new Error("Certificate cleanup failed");
  }
}
