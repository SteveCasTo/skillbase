import type { ImageMetadata } from "astro";
import { getImage } from "astro:assets";

export type ModernImageFormat = "avif" | "webp";

export async function responsiveSourceSet(
  src: ImageMetadata,
  widths: readonly number[],
  format: ModernImageFormat,
  quality: number,
): Promise<string> {
  const images = await Promise.all(
    widths.map((width) => getImage({ src, width, format, quality })),
  );
  return images
    .map((image, index) => `${image.src} ${widths[index]}w`)
    .join(", ");
}
