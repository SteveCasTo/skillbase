/** Resolve only after a private PDF response has been checked and handed to the browser. */
export async function downloadCertificatePdf(
  response: Response,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.ok || response.redirected) {
    let message =
      "La descarga no está disponible. Comprueba tu sesión y reintenta.";
    if (response.headers.get("content-type")?.includes("application/json")) {
      const result: unknown = await response.json();
      if (
        result &&
        typeof result === "object" &&
        "message" in result &&
        typeof result.message === "string"
      )
        message = result.message;
    }
    throw new Error(message);
  }
  const filename = response.headers
    .get("content-disposition")
    ?.match(/filename="([^"\\/]+)"/u)?.[1];
  if (
    !filename ||
    !/^application\/pdf(?:;|$)/iu.test(
      response.headers.get("content-type") ?? "",
    )
  )
    throw new Error("No se pudo confirmar el PDF. Reintenta la descarga.");
  const blob = await response.blob();
  const header = await blob.slice(0, 8).text();
  const trailer = await blob.slice(Math.max(0, blob.size - 1024)).text();
  if (!/^%PDF-(?:1\.[0-9]|2\.0)/u.test(header) || !/%%EOF\s*$/u.test(trailer))
    throw new Error(
      "El PDF recibido está vacío o incompleto. Reintenta la descarga.",
    );
  signal?.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // The browser's save operation is not observable; keep its Blob alive long
    // enough to consume it. This timer is cleanup, not simulated progress.
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
