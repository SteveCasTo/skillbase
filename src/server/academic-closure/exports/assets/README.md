# Closure PDF print assets

These are resized, transparent PNG derivatives of the existing institutional
assets at `assets/certificates/{umss,fcyt,informatica-sistemas}.png`. They contain
the same artwork, not generated institutional evidence, new logos or signatures.
The original assets remain unchanged.

Each image is 320 × 107 pixels, displayed at 80 pt wide (288 pixels per inch).
This avoids repeatedly decoding and embedding the full-resolution originals in
every private report. They are bundled inline, never fetched at request time.

Reproduction, using Sharp already installed by Astro (no runtime dependency):

```ts
await sharp(source)
  .resize({ width: 320, height: 168, fit: "inside", withoutEnlargement: true })
  .png({ compressionLevel: 9, palette: false })
  .toFile(destination);
```
