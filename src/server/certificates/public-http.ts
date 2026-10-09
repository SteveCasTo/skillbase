import { createHmac } from "node:crypto";
import type { CertificateRepository } from "@/application/certificates/repository";
import { getDatabase } from "@/server/db/client";
import { consumeInterestRateLimit } from "@/server/interests/rate-limit";
import { certificateFailure, certificateJson } from "./http";
import { getCertificateRepository } from "./service";

export async function consumeCertificateVerificationLimit(
  clientAddress: string,
  code: string,
) {
  const secret = process.env.AUTH_RATE_LIMIT_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Verification rate secret unavailable");
  return consumeInterestRateLimit(getDatabase(), clientAddress, code, {
    secret: createHmac("sha256", secret)
      .update("certificate-verification-v1")
      .digest("hex"),
    networkLimit: 120,
    networkSeconds: 60,
    courseLimit: 30,
    courseSeconds: 60,
  });
}
/** Address comes from the host's trusted clientAddress, never a body/header supplied IP. */
export async function handlePublicCertificateGet(input: {
  publicCredentialId: string;
  clientAddress: string;
  repository?: Pick<CertificateRepository, "verify">;
  consumeLimit?: (address: string, code: string) => Promise<number>;
}) {
  try {
    const retry = await (
      input.consumeLimit ?? consumeCertificateVerificationLimit
    )(input.clientAddress, input.publicCredentialId);
    if (retry)
      return new Response(
        JSON.stringify({
          ok: false,
          code: "RATE_LIMITED",
          message: "Espera antes de volver a verificar.",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Retry-After": String(retry),
          },
        },
      );
    return certificateJson(
      await (input.repository ?? getCertificateRepository()).verify(
        input.publicCredentialId,
      ),
    );
  } catch (error) {
    const failure = certificateFailure(error);
    return certificateJson(failure.payload, failure.status);
  }
}
