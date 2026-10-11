import type { ImageMetadata } from "astro";

export type ModernImageFormat = "avif" | "webp";

const variants = import.meta.glob<ImageMetadata>(
  "../../../assets/plates/optimized/*.{avif,webp}",
  { eager: true, import: "default" },
);

export function responsiveSourceSet(
  src: ImageMetadata,
  widths: readonly number[],
  format: ModernImageFormat,
): string {
  const name = src.src
    .split("/")
    .pop()
    ?.replace(/-\d+\..*$/, "");
  return widths
    .map((width) => {
      const image =
        variants[`../../../assets/plates/optimized/${name}-${width}.${format}`];
      if (!image)
        throw new Error(`Missing landing image: ${name}-${width}.${format}`);
      return `${image.src} ${width}w`;
    })
    .join(", ");
}
