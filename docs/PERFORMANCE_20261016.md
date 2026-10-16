# Auditoría de rendimiento — 2026-10-16

## Alcance y procedencia

Base: `7a19a468747b913913526b8b817720ad22d474bf` de `origin/development`.
Precondición comprobada antes de implementar: PR 406 MERGED, master
`f58feaf4e6916b6a8df8c1b314cd41d181aad67a`, CI `38855227139` SUCCESS y
deployment de producción SUCCESS. Esta rama no despliega ni modifica producción.

Cambio exclusivamente offline: regenerar las 50 variantes existentes de placas
desde sus cinco PNG originales, aumentando el esfuerzo de WebP/AVIF a 6. Se
conservan calidad (WebP 82, AVIF 52), dimensiones, formato, alpha y paths. No se
recomprimen variantes previas, PDFs, firmas, QR, logos ni objetos de Storage.
No hay cambios de presentación, carga, Auth, datos, schema o dependencias.

## Imágenes

Inventario local: 68 imágenes raster/vector versionadas, incluyendo originales,
variantes, favicon y logos de documentos. Las 50 variantes pasan de **6 151 822 a
5 994 611 bytes** (−157 211; −2,56 % en el conjunto, no por navegación).
Las otras 18 se conservan byte por byte. El beneficio por página depende de la
variante seleccionada por el navegador; no se descargan las 50 juntas.

Validación externa de cada archivo: decoder reconoce el formato real; dimensiones
y presencia de alpha idénticas antes/después. Comparaciones visuales lado a lado
de hero mobile y kantuta a 640 px no muestran degradación visible. No se afirma
identidad pixel a pixel de imágenes lossy.

## Medición reproducible

- Build Astro/Vercel de producción, Node 24.14.0, Bun 1.4.3, Windows, loopback.
- Preview privado en `http://127.0.0.1:4491`, sirviendo el artefacto Vercel y sus
  assets; no servidor dev. El wrapper transmite la IP loopback como lo hace el
  adapter para permitir `Astro.clientAddress` en verificación pública.
- Lighthouse 13.0.3, Chromium Playwright 1243, navegación, cuatro categorías:
  performance/accessibility/best-practices/SEO. Configuración mobile por defecto y
  desktop oficial; throttling simulado de cada preset, caché HTTP fría.
- Una muestra por ruta/dispositivo; no es una estimación estadística ni garantía
  de score. Las diferencias pequeñas de tiempos son ruido. Hubo trabajo local
  concurrente durante parte del baseline público; no atribuir variaciones de CPU
  a los assets. Bytes de archivo son una comparación determinista independiente.
- Antes de puntuar: HTTP 200, pathname final exacto y `h1` real. En ADMIN además
  cookie SSR legítima, contenido privado y `noindex`. No puntuar redirects/login.
- Auth exclusivamente local: cuenta ADMIN sintética existente y flujo oficial
  Admin API/SSR. CLI status anuncia 55321 pero el runtime coordinado usa 54321;
  se usa este último sin cambiar configuración. No se modifica Auth ni roles.

Evidencia HTML/JSON, matrices y scripts externos:
`C:/Users/Steve/AppData/Local/Temp/opencode/performance-20261016-evidence/`.
Los perfiles de Chrome y archivos `*.private.json` son privados: no publicarlos.

Baseline público ya capturado: landing, catálogo, detalle real de curso, login y
verificación pública real, ambos dispositivos. La matriz ADMIN y la comparación
posterior se completan en esta misma evidencia antes del handoff final.

## Límites y coordinación

No hay nuevos casos/specs/suites ni cambios de retries/timeouts/assertions. No
se modifican los archivos de landing/cards/404, certificados o layouts/SEO de
otros owners. No se necesitan cambios de referencias: se conservan los paths.
SEO de superficies privadas/verificación con `noindex` no tiene objetivo 100.
El gate final y los resultados completos se documentarán tras ejecutarlos.
