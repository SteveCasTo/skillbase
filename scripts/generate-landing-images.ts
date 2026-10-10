import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

// Keep the original artwork and the existing Astro encoder settings unchanged.
// Run with Bun after changing a source plate; variants are served as static assets.
const plates = {
  "cota-activa-mobile": [320, 480, 640, 960, 1198],
  "cota-activa-desktop": [640, 960, 1280, 1672],
  "cota-footer-mobile": [320, 480, 640, 960, 1122],
  "cota-footer-desktop": [640, 960, 1280, 1600, 1916],
  "kantuta-participation": [280, 420, 640, 900, 1200, 1536],
} as const;
const directory = resolve(import.meta.dir, "../assets/plates/optimized");
await mkdir(directory, { recursive: true });

for (const [name, widths] of Object.entries(plates)) {
  const source = resolve(directory, "..", `${name}.png`);
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Missing dimensions for ${name}`);
  }
  for (const width of widths) {
    const height = Math.round((width * metadata.height) / metadata.width);
    for (const format of ["webp", "avif"] as const) {
      await sharp(source, { failOn: "none", pages: -1 })
        .rotate()
        .resize({ width, height, withoutEnlargement: true })
        .toFormat(format, { quality: format === "webp" ? 82 : 52 })
        .toFile(resolve(directory, `${name}-${width}.${format}`));
    }
  }
  console.log(`Prepared ${name}: ${widths.length} sizes, WebP and AVIF`);
}
