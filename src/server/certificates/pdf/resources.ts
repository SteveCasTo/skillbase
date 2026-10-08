import { readFile } from "node:fs/promises";
import umss from "../../../../assets/certificates/umss.png?inline";
import faculty from "../../../../assets/certificates/fcyt.png?inline";
import department from "../../../../assets/certificates/informatica-sistemas.png?inline";
import regular from "@fontsource/montserrat/files/montserrat-latin-400-normal.woff?inline";
import bold from "@fontsource/montserrat/files/montserrat-latin-700-normal.woff?inline";
import display from "@fontsource/merriweather/files/merriweather-latin-700-normal.woff?inline";

/** Vite embeds the original bytes in the SSR bundle (not public URLs/Storage).
 * Bun's unit-test file loader resolves the same static imports to local paths.
 * No caller-provided path and no network access are accepted here. Existing
 * @fontsource fonts are OFL; their families approximate, not identify, the comp. */
async function bundledBytes(asset: string): Promise<Uint8Array> {
  const match = /^data:[^,]+;base64,([A-Za-z0-9+/=]+)$/.exec(asset);
  if (match) return Uint8Array.from(Buffer.from(match[1]!, "base64"));
  if (process.versions.bun) return Uint8Array.from(await readFile(asset));
  throw new Error("Certificate asset was not bundled inline.");
}

export async function certificateResources() {
  const [
    umssBytes,
    facultyBytes,
    departmentBytes,
    regularBytes,
    boldBytes,
    displayBytes,
  ] = await Promise.all(
    [umss, faculty, department, regular, bold, display].map(bundledBytes),
  );
  return {
    logos: [umssBytes!, facultyBytes!, departmentBytes!] as const,
    regular: regularBytes!,
    bold: boldBytes!,
    display: displayBytes!,
  };
}
