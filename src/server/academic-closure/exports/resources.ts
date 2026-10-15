import { readFile } from "node:fs/promises";
import umss from "../../../../assets/certificates/umss.png?inline";
import faculty from "../../../../assets/certificates/fcyt.png?inline";
import department from "../../../../assets/certificates/informatica-sistemas.png?inline";
import regular from "@fontsource/montserrat/files/montserrat-latin-400-normal.woff?inline";
import bold from "@fontsource/montserrat/files/montserrat-latin-700-normal.woff?inline";

/** Fixed project assets, embedded by Vite in SSR; Bun tests resolve local paths.
 * Never accepts a request path, performs network I/O or writes participant data. */
async function bytes(asset: string): Promise<Uint8Array> {
  const match = /^data:[^,]+;base64,([A-Za-z0-9+/=]+)$/.exec(asset);
  if (match) return Uint8Array.from(Buffer.from(match[1]!, "base64"));
  if (process.versions.bun) return Uint8Array.from(await readFile(asset));
  throw new Error("Closure asset was not bundled inline.");
}

export async function closurePdfResources() {
  const [regularFont, boldFont, ...logos] = await Promise.all(
    [regular, bold, umss, faculty, department].map(bytes),
  );
  return { regular: regularFont!, bold: boldFont!, logos };
}
