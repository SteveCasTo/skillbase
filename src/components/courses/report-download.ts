import { notifications } from "@/lib/notifications";

const pending = new Set<AbortController>();
async function download(
  url: URL,
  format: "CSV" | "PDF",
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok || response.redirected) {
    let message = "No se pudo descargar. Comprueba tu sesión y reintenta.";
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
    ?.match(/filename="(cursos-[a-z0-9.-]+\.(?:csv|pdf))"/iu)?.[1];
  const blob = await response.blob();
  const mediaType = response.headers.get("content-type") ?? "";
  let valid = false;
  if (format === "CSV") {
    const prefix = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    valid =
      /^text\/csv(?:;|$)/iu.test(mediaType) &&
      prefix[0] === 239 &&
      prefix[1] === 187 &&
      prefix[2] === 191;
  } else {
    const header = await blob.slice(0, 8).text();
    const trailer = await blob.slice(Math.max(0, blob.size - 1024)).text();
    valid =
      /^application\/pdf(?:;|$)/iu.test(mediaType) &&
      /^%PDF-(?:1\.[0-9]|2\.0)/u.test(header) &&
      /%%EOF\s*$/u.test(trailer);
  }
  if (
    !filename?.endsWith(`.${format.toLowerCase()}`) ||
    blob.size < 20 ||
    !valid
  )
    throw new Error(
      `No se pudo confirmar el ${format}. Reintenta la descarga.`,
    );
  signal.throwIfAborted();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = objectUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }
}
export function initializeCourseReports() {
  document
    .querySelectorAll<HTMLAnchorElement>("[data-course-report]")
    .forEach((link) => {
      if (link.dataset.bound) return;
      link.dataset.bound = "true";
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        if (link.dataset.pending) return;
        const format = link.dataset.courseReport;
        if (format !== "CSV" && format !== "PDF") return;
        const url = new URL(link.href);
        const form = document.querySelector<HTMLFormElement>(
          '[data-search-list="cursos"] [data-list-search]',
        );
        if (form) {
          const data = new FormData(form);
          url.searchParams.set("search", String(data.get("search") ?? ""));
          url.searchParams.set(
            "status",
            String(data.get("status") ?? "PUBLISHED"),
          );
        }
        const controller = new AbortController();
        pending.add(controller);
        link.dataset.pending = "true";
        link.setAttribute("aria-disabled", "true");
        link.setAttribute("aria-busy", "true");
        try {
          await notifications.promise(
            download(url, format, controller.signal),
            {
              loading: { title: `Preparando ${format}…` },
              success: { title: "Informe descargado" },
              error: (error: unknown) => ({
                title: "Sin descarga",
                description:
                  error instanceof Error
                    ? error.message
                    : "Reintenta la descarga.",
              }),
            },
          );
        } catch {
          /* The real promise's rejection is already presented by Sileo. */
        } finally {
          pending.delete(controller);
          delete link.dataset.pending;
          link.removeAttribute("aria-disabled");
          link.removeAttribute("aria-busy");
        }
      });
    });
}
document.addEventListener("astro:before-swap", () => {
  pending.forEach((controller) => controller.abort());
  pending.clear();
});
