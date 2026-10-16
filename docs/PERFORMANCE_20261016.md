# Auditoría de rendimiento — 2026-10-16

## Alcance y procedencia

Base: `7a19a468747b913913526b8b817720ad22d474bf` de `origin/development`.
Precondición comprobada antes de implementar: PR 406 MERGED, master
`f58feaf4e6916b6a8df8c1b314cd41d181aad67a`, CI `38855227139` SUCCESS y
deployment de producción SUCCESS. Esta rama no despliega ni modifica producción.

Tras integrarse PR 423/424/425/426, la rama se rebaseó sobre
`7b397124a336c4704df75fb202e3d840697c9b39`. La comparación aislada de abajo conserva
su procedencia histórica; no se presenta la versión anterior de cards como el
estado actual. La matriz final usa el build combinado con esos PRs más esta rama,
separando ese efecto de los bytes deterministas de las placas.

Cambio exclusivamente offline: regenerar las variantes existentes de placas
desde sus cinco PNG originales, aumentando el esfuerzo de WebP/AVIF opaco a 6. Se
conservan calidad (WebP 82, AVIF 52), dimensiones, formato, alpha y paths. No se
recomprimen variantes previas, PDFs, firmas, QR, logos ni objetos de Storage.
No hay cambios de presentación, carga, Auth, datos, schema o dependencias.

## Imágenes

Inventario local inicial: 68 imágenes raster/vector versionadas, incluyendo originales,
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

Auditoría de entrega existente (sin cambiar archivos de otros owners):

| Familia                    | Formato/responsive                                                                 | Carga y límites                                                 |
| -------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Hero                       | Picture AVIF/WebP, media mobile/desktop, srcset de variantes y sizes 100vw         | Eager/high; no lazy en LCP                                      |
| Footer                     | Picture AVIF/WebP, srcset separado mobile/desktop, sizes 100vw                     | Lazy; dimensiones explícitas                                    |
| Kantuta                    | AVIF/WebP, seis anchos, sizes según composición                                    | Lazy; alpha preservado                                          |
| Preview sintético de curso | JPG fuente procesado por Astro Image a WebP con widths/sizes                       | No sustituye artwork real; prioridad según destacado            |
| Upload de curso            | WebP 1200×750; dimensiones en consumidores, destacado eager/high, secundarios lazy | Sin variantes remotas existentes: no inventar srcset de Storage |
| Logos/favicons             | PNG de documentos y SVG vectorial                                                  | Conservados; no convertir SVG ni recomprimir PDFs               |

Los PNG fuente de placas se conservan como originales; no se sirven en lugar de
las variantes ya optimizadas. No añadir conversiones duplicadas sin consumidor.
El nuevo asset 404 de PR 425 queda expresamente fuera de esta optimización.

Inventario final reconciliado: **70 imágenes versionadas**, 44 modificadas y 26
intactas. `all-images-final-inventory.json` incluye dimensiones, formato decodificado,
alpha, tamaño y SHA-256 antes/después de todas ellas frente a development7b397124.
Incluye los dos WebP 404 de PR425, sin optimizarlos ni atribuir su ahorro:
`not-found-640.webp` (640×427, 47196 bytes) y `not-found-1280.webp` (1280×853,
136552 bytes). Ambos conservan exactamente los hashes de development. No se
convierte el SVG ni se fuerzan nuevos WebP donde ya existe AVIF apropiado.

## Medición reproducible

- Build Astro/Vercel de producción, Node 24.14.0, Bun 1.4.3, Windows, loopback.
- Preview privado en `http://127.0.0.1:4491`, sirviendo el artefacto Vercel y sus
  assets; no servidor dev. El wrapper transmite la IP loopback como lo hace el
  adapter para permitir `Astro.clientAddress` en verificación pública.
- Lighthouse 13.0.3, Chromium Playwright 1243, navegación, cuatro categorías:
  performance/accessibility/best-practices/SEO. Configuración mobile por defecto y
  desktop oficial; throttling simulado de cada preset. Públicas usan reset de
  storage de Lighthouse; ADMIN conserva storage/cookies con
  `disableStorageReset=true` para mantener la sesión. No se declara ADMIN como
  una purga completa de caché: el wrapper no publica cache headers/ETags y las
  trazas muestran assets transferidos con HTTP 200. Misma política antes/después.
- El wrapper local no habilita compresión HTTP; transferencias/JS se comparan
  bajo esa misma condición, no representan bytes gzip de Vercel/CDN.
- Una muestra por ruta/dispositivo; no es una estimación estadística ni garantía
  de score. Las diferencias pequeñas de tiempos pueden ser ruido. Hubo trabajo local
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

Reconciliación del template administrativo adicional
`/app/cursos/[id]/grupos/[groupId]/certificados/[type]/[recipientId]`:
se solicitó con curso/grupo/destinatario reales existentes, sesión ADMIN y sin
seguir redirects inicialmente. Devuelve **302** al detalle de su certificado
vigente; el destino final muestra «Certificado de aprobación», noindex y cookie
válida, nunca login. Ese detalle ya tiene sus dos informes. Evidencia:
`recipient-route-reconciliation.json`; comportamiento en `recipient-route.ts:71`.
Por tanto: 31 templates ADMIN puntuados + 2 aliases settings + 1 template de
destinatario reconciliado por redirect legítimo. La rama HTML200 de destinatario
sin certificado no se ejercita: no se crean fixtures ni se revocan certificados
canónicos para forzarla, y no se inventa una puntuación para ese estado.

La DB local contiene cero keys de artwork: las páginas medidas usan el fallback
gráfico real. No se atribuye ahorro a uploads que no existen en esta muestra.
El pipeline existente ya exporta WebP 1200 × 750 desde canvas y valida en servidor
origen, actor ADMIN activo, MIME/extensión/tamaño, contenedor y dimensiones antes
de Storage. No se cambia ese contrato ni se migran objetos reales. El detalle
público y tarjetas que consumen futuros uploads pertenecen a otros owners; no se
introduce aquí un proxy/transformación remota ni `srcset` con variantes inexistentes.

`dynamic-images-audit-final.json` cierra el inventario dinámico por lectura local:
0 keys de artwork y 0 objetos del bucket course-artwork. Los únicos objetos Storage
son 11 documentos de certificados (15103939 bytes por metadata); se excluyen por
finalidad y no se descargan ni recomprimen. El JSON inicial vacío queda como muestra
de los consumidores renderizados, no como afirmación de inventario completo.
**Cloud no se inventarió**: no hay cobertura de objetos reales cloud ni afirmación
de que todos sus uploads cumplan dimensiones/bytes. No se accede a sus bytes ni se
mutan objetos; el contrato futuro permanece en el pipeline autorizado existente.

## Resultado aislado antes/después (base anterior a PR 425)

Comparación completa: **144 informes = 36 páginas × 2 dispositivos × 2 builds**.
Evidencia histórica `baseline-matrix.json`/`after-matrix.json`, con las
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

### Combinado final vigente

[Matriz final completa](PERFORMANCE_20261016_MATRIX.md): 72 pares baseline→final
con las 36 páginas y ambos dispositivos. Build medido de implementación
`3a2a7b24a6b3ce912d5a70e19c8374be6747fcd0`, sobre development `7b397124`; los cambios
posteriores a ese SHA son solo esta documentación/matriz. Cada una de las cinco
etapas conservadas en evidencia tiene 72 informes únicos: baseline, after aislado,
combined (PR425), current (PR424+425) y final (PR423–426). No se sustituyeron muestras
para mejorar scores; las etapas adicionales responden a integraciones coordinadas.
`EVIDENCE-VALIDATION.json` comprueba 360 informes, 310 autenticados, URL final exacta,
HTTP 200, h1 y cookie ADMIN. Las rutas ya completadas no se repitieron al reanudar
procesos interrumpidos por el entorno.

`FINAL-PROVENANCE.json` vincula los SHA/árboles del baseline y del build final con
sus matrices de 72 muestras. El árbol fuera de `docs/` del SHA publicado coincide
exactamente con el build medido; la documentación posterior no cambia runtime ni
assets. Los JSON individuales guardan presets, categorías y finalDisplayedUrl;
sus pares HTML conservan los informes inspeccionables. Los archivos `*-content.json`
aportan HTTP200, h1, robots y presencia de cookie sin publicar valores de cookies.

| Superficie   | Performance final mobile / desktop | LCP mobile / desktop (ms) | CLS mobile / desktop |
| ------------ | ---------------------------------- | ------------------------- | -------------------- |
| Landing      | 92 / 100                           | 2859 / 687                | 0,0013 / 0,0010      |
| Catálogo     | 96 / 100                           | 2331 / 546                | 0,0007 / 0,0008      |
| Curso        | 97 / 100                           | 2108 / 730                | 0,0023 / 0,0020      |
| Login        | 80 / 100                           | 4206 / 646                | 0,0005 / 0,0259      |
| Verificación | 79 / 100                           | 4205 / 528                | 0,0381 / 0,0045      |

TBT final público: 0 ms en las diez muestras. FCP/SI y transferencia/JS completos
figuran por ruta en la matriz, incluidos los 31 ADMIN. ADMIN final performance
59–98 mobile y 87–99 desktop; no se ocultan mínimos ni se persigue SEO100.
PR423 introduce noindex correcto en login/ADMIN (SEO60), PR424 modifica verificación
y PR426 feedback. Por tanto, el cambio final de bytes/JS/CLS/score en esas rutas
**no se atribuye a esta optimización de placas**. Verificación pasa de 219797 a
598502 bytes en el combinado, incorporando interacción del otro owner.

Landing final: 352236→351670 bytes mobile y 465831→465290 desktop; el ahorro neto
combinado (566/541 bytes) incluye overhead de los otros PRs y no sustituye el ahorro
aislado de 1088/1063 bytes ni el ahorro determinista de archivos de 144973 bytes.
Landing mobile SEO92 reporta `robots-txt` en el preview local; no se añade un robots
global ni se afirma un problema productivo a partir de esa medición local aislada.
Los hallazgos de contraste/nombre accesible que quedan se entregan a sus owners.

### Gates

- Local: lint, formatter, Astro check (0 errores, 0 warnings; 383 hints), 464 unit
  (0 fallos), build de producción final y `git diff --check`.
- CI del primer candidato `38908521760`: quality, integración 177, demos aisladas
  y 145 E2E (76+69), 0 flaky/0 retries. Es evidencia del candidato previo, no del
  ajuste final de alpha; los checks del SHA final se consultan en
  [PR 427](https://github.com/SteveCasTo/skillbase/pull/427/checks).
- Inventario de 68 imágenes y comparación de dimensiones/formato/alpha; revisión
  visual de las cinco placas en contact sheet y detalle hero/kantuta. La captura
  no reemplaza la auditoría de rutas ni una prueba institucional de los logos.

La instalación local de Astro carecía de un módulo de runtime al reconstruir tras
el rebase; `bun install --frozen-lockfile --force` reparó exclusivamente dependencias
locales. El build integrado posterior pasó sin editar source, versiones o lockfile.

## Límites y coordinación

No hay nuevos casos/specs/suites ni cambios de retries/timeouts/assertions. No
se modifican los archivos de landing/cards/404, certificados o layouts/SEO de
otros owners. No se necesitan cambios de referencias: se conservan los paths.
SEO de superficies privadas/verificación con `noindex` no tiene objetivo 100.
El gate final y los resultados completos se documentarán tras ejecutarlos.
