# Presentación del repositorio

Los logotipos son activos propios generados para SkillBase y autorizados por Steve (SteveCasTo), titular del proyecto. Se distribuyen bajo la [licencia MIT del repositorio](../../LICENSE). No son logotipos oficiales de la UMSS ni acreditan respaldo institucional.

- `skillbase-horizontal.png`: logotipo horizontal transparente; se recortó únicamente el margen transparente para mejorar su lectura en el README.
- `skillbase-isotipo-s.png`: isotipo transparente original.
- `skillbase-landing-preview.png` y `skillbase-verifier-preview.png`: capturas de las páginas públicas de la aplicación (1440 × 900), sin datos personales. La ilustración territorial de la landing es conceptual, no una fotografía documental; véase su [procedencia](../plates/cota-activa.provenance.md). No representan oferta académica real.
- `skillbase-social-preview.png`: composición de 1280 × 640 para la presentación del repositorio, sin recursos externos ni imágenes rotas. Reutiliza el logotipo, Montserrat y los colores del sistema visual. Su fuente es `skillbase-social-preview.html`.

## Regenerar la imagen social

Desde la raíz, con las dependencias del proyecto y Chromium de Playwright ya instalados:

```sh
bun --no-env-file -e "const { chromium } = await import('@playwright/test'); const { pathToFileURL } = await import('node:url'); const { resolve } = await import('node:path'); const browser = await chromium.launch(); try { const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 }); await page.goto(pathToFileURL(resolve('assets/branding/skillbase-social-preview.html')).href); await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: 'assets/branding/skillbase-social-preview.png' }); } finally { await browser.close(); }"
```

Este HTML es una fuente de diseño local, no una página de la aplicación. El PNG queda versionado y no requiere JavaScript al visualizarlo. Un commit no configura la imagen social de GitHub: un administrador debe subir el PNG en **Settings → General → Social preview**. No modifica los metadatos de la aplicación.
