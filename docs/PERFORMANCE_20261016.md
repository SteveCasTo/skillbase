# Auditoría de rendimiento — 2026-10-16

## Alcance y procedencia

Base: `7a19a468747b913913526b8b817720ad22d474bf` de `origin/development`.
Precondición comprobada antes de implementar: PR 406 MERGED, master
`f58feaf4e6916b6a8df8c1b314cd41d181aad67a`, CI `38855227139` SUCCESS y
deployment de producción SUCCESS. Esta rama no despliega ni modifica producción.

Cambio exclusivamente offline: regenerar las variantes existentes de placas
desde sus cinco PNG originales, aumentando el esfuerzo de WebP/AVIF opaco a 6. Se
conservan calidad (WebP 82, AVIF 52), dimensiones, formato, alpha y paths. No se
recomprimen variantes previas, PDFs, firmas, QR, logos ni objetos de Storage.
No hay cambios de presentación, carga, Auth, datos, schema o dependencias.

## Imágenes

Inventario local: 68 imágenes raster/vector versionadas, incluyendo originales,
variantes, favicon y logos de documentos. Las 50 variantes pasan de **6 151 822 a
6 006 849 bytes** (−144 973; −2,36 % en el conjunto, no por navegación).
44 variantes cambian; seis AVIF transparentes y las otras 18 imágenes se conservan
byte por byte. El beneficio por página depende de la
variante seleccionada por el navegador; no se descargan las 50 juntas.

| Formato | Antes (bytes) | Después (bytes) |  Ahorro |
| ------- | ------------: | --------------: | ------: |
| WebP    |     4 250 470 |       4 115 218 | 135 252 |
| AVIF    |     1 901 352 |       1 891 631 |   9 721 |

Validación externa de cada archivo: decoder reconoce el formato real; dimensiones
y presencia de alpha idénticas antes/después. Los seis WebP transparentes conservan
también cada valor de alpha decodificado exactamente. La primera candidata AVIF
con esfuerzo 6 alteraba valores de alpha, por lo que se conservó esfuerzo 4 en
esas seis variantes y sus bytes originales; no se publican como ahorro.
Comparaciones visuales lado a lado
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
- El wrapper local no habilita compresión HTTP; transferencias/JS se comparan
  bajo esa misma condición, no representan bytes gzip de Vercel/CDN.
- Una muestra por ruta/dispositivo; no es una estimación estadística ni garantía
  de score. Las diferencias pequeñas de tiempos son ruido. Hubo trabajo local
  concurrente durante parte del baseline público; no atribuir variaciones de CPU
  a los assets. Bytes de archivo son una comparación determinista independiente.
- Antes de puntuar: HTTP 200, pathname final exacto y `h1` real. En ADMIN además
  cookie SSR legítima y contenido privado. Se registra `robots`: el baseline
  carece de `noindex`, hallazgo entregado al owner SEO (no corregido aquí).
  No se puntúan redirects/login como si fueran páginas privadas.
- Auth exclusivamente local: cuenta ADMIN sintética existente y flujo oficial
  Admin API/SSR. CLI status anuncia 55321 pero el runtime coordinado usa 54321;
  se usa este último sin cambiar configuración. No se modifica Auth ni roles.

Evidencia HTML/JSON, matrices y scripts externos:
`C:/Users/Steve/AppData/Local/Temp/opencode/performance-20261016-evidence/`.
Los perfiles de Chrome y archivos `*.private.json` son privados: no publicarlos.

Baseline: 72 informes (36 páginas × 2 dispositivos), con URL final, HTTP 200,
contenido y cookies privados comprobados. 5 públicas: landing, catálogo, detalle
real de curso, login y verificación pública real. 31 ADMIN:

- Cursos, alta, edición; grupos, participantes y calendario/sesión real.
- Esquema de evaluaciones y notas del grupo; cierre actual e histórico real.
- Interesados y detalle de demanda del curso.
- Preinscripciones, alta y ficha con pagos/ledger.
- Formatos, alta y detalle.
- Instructores, alta y edición.
- Administradores, alta y detalle.
- Certificados, documento individual y grupo.
- Configuración global (incluye asistencia y firmantes), perfil y contraseña.

Inventario de enlaces reales de navegación y subpáginas en `*-content.json`.
Los GET de `/app/configuracion/asistencia` y `/app/configuracion/certificados`
redirigen deliberadamente al panel combinado: se registran, no se puntúan como
páginas distintas. Informes PDF/CSV se ofrecen desde Cursos y Preinscripciones;
son descargas, no páginas HTML puntuables por Lighthouse. Pagos vive dentro de la
ficha de preinscripción, no hay una página adicional de caja en la navegación.

La DB local contiene cero keys de artwork: las páginas medidas usan el fallback
gráfico real. No se atribuye ahorro a uploads que no existen en esta muestra.
El pipeline existente ya exporta WebP 1200 × 750 desde canvas y valida en servidor
origen, actor ADMIN activo, MIME/extensión/tamaño, contenedor y dimensiones antes
de Storage. No se cambia ese contrato ni se migran objetos reales. El detalle
público y tarjetas que consumen futuros uploads pertenecen a otros owners; no se
introduce aquí un proxy/transformación remota ni `srcset` con variantes inexistentes.

## Resultado antes/después

Comparación completa: **144 informes = 36 páginas × 2 dispositivos × 2 builds**.
[Matriz legible por ruta y dispositivo](PERFORMANCE_20261016_MATRIX.md), con las
cuatro puntuaciones, LCP/CLS/TBT/FCP/SI, transferencia total y JavaScript. Los JSON
incluyen el desglose de imágenes, fuentes, CSS y otros recursos; los HTML permiten
inspeccionar nodos y oportunidades. No se reemplaza una muestra desfavorable por
reintentos ni se afirma que todas las páginas alcancen 100.

| Superficie    | Performance mobile antes→después | Desktop antes→después |
| ------------- | -------------------------------: | --------------------: |
| Landing       |                            92→92 |               100→100 |
| Catálogo      |                            95→96 |               100→100 |
| Curso público |                            92→86 |                 99→98 |
| Login         |                            93→94 |                99→100 |
| Verificación  |                            95→97 |               100→100 |

Landing transfiere 352 236→351 148 bytes mobile (−1 088) y
465 831→464 768 desktop (−1 063). LCP mobile 2861→2861 ms: ahorro de bytes real,
sin mejora temporal demostrada. Catálogo/curso/login/verificación y ADMIN no
consumen estas placas: sus bytes de JS permanecen iguales; los cambios de scores
no se atribuyen a esta optimización. En particular se conserva el resultado
desfavorable del curso (LCP mobile 2900→3456 ms), sin ocultarlo ni afirmar una
regresión causada por assets que esa ruta no carga. Una muestra por condición no
permite separar ruido/contención local de otras causas temporales.

ADMIN después: performance mobile 61–98 y desktop 90–100. No se manipula contenido,
hydration o loading para maquillar resultados. Las superficies pesadas merecen
trabajo posterior sobre JS/SSR, no una promesa de mejora por estas imágenes.

Handoff a owners: `A11Y-SEO-HANDOFF.json` contiene los nodos/contrastes/nombres
accesibles por ruta; `LOGIN-CLS-HANDOFF.json` documenta CLS mobile baseline 0,1302.
Falta noindex en ADMIN baseline; verificación pública lo conserva correctamente.
No se introducen aquí cambios globales de SEO/a11y ni modificaciones de sus owners.

## Validación

- Local: lint, formatter, Astro check (0 errores, 0 warnings; 383 hints), 464 unit
  (0 fallos), build de producción final y `git diff --check`.
- CI del primer candidato `38908521760`: quality, integración 177, demos aisladas
  y 145 E2E (76+69), 0 flaky/0 retries. Es evidencia del candidato previo, no del
  ajuste final de alpha; los checks del SHA final se consultan en
  [PR 427](https://github.com/SteveCasTo/skillbase/pull/427/checks).
- Inventario de 68 imágenes y comparación de dimensiones/formato/alpha; revisión
  visual de las cinco placas en contact sheet y detalle hero/kantuta. La captura
  no reemplaza la auditoría de rutas ni una prueba institucional de los logos.

## Límites y coordinación

No hay nuevos casos/specs/suites ni cambios de retries/timeouts/assertions. No
se modifican los archivos de landing/cards/404, certificados o layouts/SEO de
otros owners. No se necesitan cambios de referencias: se conservan los paths.
SEO de superficies privadas/verificación con `noindex` no tiene objetivo 100.
El gate final y los resultados completos se documentarán tras ejecutarlos.
