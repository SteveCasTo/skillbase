# Static derivatives of Cota Activa plates

These files derive only from the five existing PNG plates in the parent directory.
Their existing provenance remains authoritative; these are not new photographs or
new branding assets. Original plates are preserved without modification.

Regenerate with `bun scripts/generate-landing-images.ts` after changing a plate.
The script uses the Sharp installation already provided by Astro (no additional
runtime dependency). It preserves Astro's existing resize/aspect-ratio behavior,
WebP quality 82 and AVIF quality 52. Neither dimensions nor compression quality
were lowered for the performance change.

Variants are committed so ordinary production builds serve fingerprinted static
files without request-time image encoding. Responsive widths, art direction,
priority and lazy-loading policy remain owned by the landing components.

Measured evidence and limitations: `docs/validation/PERFORMANCE.md`.
