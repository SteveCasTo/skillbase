import { InterestError } from "@/domain/interests/rules";
import type { InterestFormValues } from "@/domain/interests/types";
export const INTEREST_BODY_LIMIT = 8192;
export function blankInterestValues(): InterestFormValues {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    preferredGroupId: "",
  };
}
export function ownInterestValues(raw: unknown): InterestFormValues {
  const values = blankInterestValues();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return values;
  const source = raw as Record<string, unknown>;
  for (const key of Object.keys(values) as (keyof InterestFormValues)[])
    if (typeof source[key] === "string")
      values[key] = source[key].slice(0, 254).replace(/\p{Cc}/gu, "");
  return values;
}
export async function readInterestRequest(
  request: Request,
  limit = INTEREST_BODY_LIMIT,
): Promise<unknown> {
  const tooLarge = () =>
    new InterestError(
      "BODY_TOO_LARGE",
      413,
      "La solicitud supera el tamaño permitido.",
    );
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit))
    throw tooLarge();
  const mime = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    mime !== "application/json" &&
    mime !== "application/x-www-form-urlencoded"
  )
    throw new InterestError(
      "UNSUPPORTED_CONTENT_TYPE",
      415,
      "El formato de la solicitud no está admitido.",
    );
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw tooLarge();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (mime === "application/json") return JSON.parse(text) as unknown;
    const input: Record<string, string> = Object.create(null) as Record<
      string,
      string
    >;
    for (const [key, value] of new URLSearchParams(text)) {
      if (Object.hasOwn(input, key)) throw new Error("Repeated field");
      input[key] = value;
    }
    return input;
  } catch {
    throw new InterestError(
      "INVALID_REQUEST",
      400,
      "La solicitud no es válida.",
    );
  }
}
