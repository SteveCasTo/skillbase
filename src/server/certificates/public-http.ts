import { createHmac } from "node:crypto";
import type { CertificateRepository } from "@/application/certificates/repository";
import { getDatabase } from "@/server/db/client";
import { consumeInterestRateLimit } from "@/server/interests/rate-limit";
import { certificateFailure, certificateJson } from "./http";
import { getCertificateRepository } from "./service";
import { verifySignedFile } from "@/application/certificates/verify-signed-file";
import { CertificateError } from "@/domain/certificates/rules";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { readInterestRequest } from "@/server/interests/request";

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

/** The PDF never reaches this adapter: only its complete SHA-256 in a bounded body. */
export async function handlePublicCertificateFilePost(input: {
  request: Request;
  siteUrl: URL;
  clientAddress: string;
  repository?: Pick<CertificateRepository, "verifySignedHash">;
  consumeLimit?: (address: string, key: string) => Promise<number>;
}) {
  try {
    if (!requestHasExpectedOrigin(input.request, input.siteUrl))
      throw new CertificateError("FORBIDDEN", "Origen no válido.");
    const raw = await readInterestRequest(input.request, 256);
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== 1 ||
      !("sha256" in raw)
    )
      throw new CertificateError("VALIDATION_FAILED", "Solicitud no válida.");
    // Invalid requests share a limiter key, and both entry paths share the network budget.
    const digest =
      typeof raw.sha256 === "string" && /^[a-f0-9]{64}$/u.test(raw.sha256)
        ? raw.sha256
        : "invalid-file-digest";
    const retry = await (
      input.consumeLimit ?? consumeCertificateVerificationLimit
    )(input.clientAddress, digest);
    if (retry) {
      const response = certificateJson(
        {
          ok: false,
          code: "RATE_LIMITED",
          message: "Espera antes de volver a verificar.",
        },
        429,
      );
      response.headers.set("Retry-After", String(retry));
      return response;
    }
    return certificateJson(
      await verifySignedFile(
        input.repository ?? getCertificateRepository(),
        raw.sha256,
      ),
    );
  } catch (error) {
    const failure = certificateFailure(error);
    return certificateJson(failure.payload, failure.status);
  }
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
