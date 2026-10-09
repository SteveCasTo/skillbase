export const LOCAL_PDF_MAX_BYTES = 10 * 1024 * 1024;

export function localPdfError(
  file: Pick<File, "name" | "size" | "type">,
): string {
  if (!/\.pdf$/iu.test(file.name) || file.type !== "application/pdf")
    return "Selecciona un archivo PDF.";
  if (!file.size || file.size > LOCAL_PDF_MAX_BYTES)
    return "El PDF debe tener contenido y pesar como máximo 10 MiB.";
  return "";
}

/** Full exact bytes. No uploads, normalization, persistence or network APIs. */
export async function localPdfSha256(file: File): Promise<string> {
  const error = localPdfError(file);
  if (error) throw new Error(error);
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function hashComparison(
  hash: string,
  official: string,
  state: string,
): string {
  if (!/^[a-f0-9]{64}$/iu.test(official))
    return "Todavía no hay un hash oficial para comparar.";
  if (hash.toLowerCase() !== official.toLowerCase())
    return "El archivo no coincide con el PDF firmado registrado.";
  if (state !== "issued")
    return "El archivo coincide, pero el certificado no es válido: está revocado o reemplazado.";
  return "El archivo coincide con el PDF firmado del certificado vigente.";
}
