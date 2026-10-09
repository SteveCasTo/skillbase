import type { CertificateTemplateData } from "@/domain/certificates/types";
export interface CertificatePdfRenderer {
  render(data: CertificateTemplateData): Promise<Uint8Array>;
}
export interface CertificateStorage {
  put(path: string, bytes: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
}
