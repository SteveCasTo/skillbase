# TESTING

## OBJETIVO

Mantener un entorno de pruebas reproducible, aislado y cercano a producción.

Las pruebas deben detectar defectos antes de que un cambio llegue a `master`.

## PRINCIPIOS

- Los tests evolucionan junto con el código.
- No depender de datos manuales.
- No usar producción para pruebas.
- No usar OAuth real de Google como dependencia general de E2E.
- Las pruebas deben poder ejecutarse en Linux mediante GitHub Actions.
- El resultado debe ser reproducible en cualquier equipo del grupo.
- No instalar infraestructura innecesaria en CI.

## NIVELES

### Unit

Para:

- cálculos;
- reglas;
- validaciones puras;
- políticas;
- transformaciones.

Preferir sin base de datos.

Ejemplos:

- calcular nota final;
- calcular asistencia;
- calcular descuento;
- determinar elegibilidad.

### Integration

Para:

- repositories;
- queries;
- transacciones;
- services con PostgreSQL;
- RLS cuando corresponda;
- Storage cuando corresponda.

Utilizar Supabase local.

### E2E

Playwright.

Cubrir los flujos críticos:

- autenticación;
- publicación de curso;
- preinscripción;
- creación de grupo;
- inscripción;
- asistencia;
- evaluación;
- cierre;
- certificado;
- verificación pública.

No automatizar Google UI para cada test.

Crear mecanismos de autenticación de test controlados.

## DOCKER Y SUPABASE LOCAL

Supabase CLI gestiona los servicios locales mediante Docker.

No añadir una segunda base PostgreSQL si no existe una necesidad específica.

Los archivos de configuración de CI deben utilizar únicamente servicios necesarios.

No levantar contenedores que una suite concreta no use.

## ENTORNO DE TEST

Flujo conceptual:

```text
start services
→ migrations
→ reset
→ test fixtures
→ unit/integration/e2e
→ reports
→ cleanup
```

El entorno debe tener datos conocidos antes de cada suite.

## SEEDS Y FIXTURES

Separar:

- development seed;
- test fixtures.

Los datos de desarrollo pueden ser amplios.

Los fixtures deben ser mínimos y deterministas.

Nunca usar información personal real.

## PLAYWRIGHT

### Reglas

- Preferir selectors semánticos.
- Preferir `getByRole`.
- Preferir `getByLabel`.
- Evitar selectors acoplados a estructura CSS.
- No usar sleeps arbitrarios.
- Esperar estados observables.
- Capturar traces/screenshots en fallos cuando ayude al diagnóstico.
- Mantener browsers mínimos necesarios en CI.

### UI

Los tests E2E deben validar comportamiento, no pixel-perfect rendering salvo que exista una suite visual específica.

Cuando cambia la UI:

- actualizar test solo si cambió deliberadamente el comportamiento esperado;
- no cambiar expectativas para ocultar defectos.

## ACCESSIBILITY TESTING

Incluir verificaciones progresivas:

- HTML semántico;
- navegación por teclado;
- foco;
- labels;
- contraste;
- estados;
- ARIA cuando corresponda.

Puede incorporarse automatización adicional si el equipo lo considera útil.

La automatización no reemplaza revisión manual.

## CI

Todo PR relevante y cualquier push a `master` debe ejecutar, según corresponda:

1. instalación reproducible;
2. lint;
3. format check;
4. typecheck;
5. unit tests;
6. integration tests;
7. E2E;
8. build de producción.

El build es obligatorio aunque los tests pasen.

## PARALELISMO

GitHub Actions puede dividir trabajo entre jobs.

Ejemplo:

- static-checks;
- unit;
- integration;
- e2e;
- build.

No duplicar innecesariamente la instalación pesada de Supabase en jobs que no necesitan base.

Ejemplo:

`lint`, `typecheck` y unit tests puros no necesitan Supabase.

Integration y E2E sí.

## IMÁGENES DOCKER

Reglas:

- usar imágenes oficiales;
- fijar versiones;
- no usar imágenes `latest`;
- instalar solo browsers necesarios;
- evitar servicios innecesarios;
- aprovechar cache cuando sea seguro;
- mantener workflows legibles.

## COMANDOS ESPERADOS

El proyecto debe tender a scripts equivalentes a:

```text
bun run test
bun run test:unit
bun run test:integration
bun run test:e2e
bun run test:all
bun run lint
bun run format:check
bun run typecheck
bun run build
bun run check
```

`check` debe ejecutar las validaciones estáticas apropiadas.

`test:all` no necesariamente debe duplicar `build`.

La combinación CI definitiva se documentará en `DEPLOYMENT.md`.

### Implementación de Foundation

| Comando                    | Alcance                                         | Infraestructura |
| -------------------------- | ----------------------------------------------- | --------------- |
| `bun run test`             | Alias de unit tests                             | Ninguna         |
| `bun run test:unit`        | Utilidades y comportamiento puro                | Ninguna         |
| `bun run test:integration` | Repositorios y Auth en stack temporal aislado   | Docker/Supabase |
| `bun run test:e2e`         | UI en Chromium; stack temporal y Astro dedicado | Docker/Chromium |
| `bun run test:all`         | Unit, integration y E2E                         | Docker/Supabase |
| `bun run check`            | ESLint, Prettier check y Astro check            | Ninguna         |
| `bun run validate`         | Checks, todas las pruebas y build               | Docker/Supabase |

Para integración y E2E solo se necesita Docker encendido (y para E2E `bunx playwright install chromium`). **No ejecutar `db:reset` ni `supabase:start` para probar**: cada comando crea su propio proyecto Supabase temporal con puertos y volúmenes Docker propios, aplica migraciones Drizzle a su DB, obtiene Auth/Storage/keys del proyecto temporal y lo detiene/elimina al terminar. No modifica `.env`, el stack habitual ni sus datos. Integration y E2E pueden correr a la vez con stacks distintos; E2E reserva `127.0.0.1:4321` para Astro y falla si está ocupado, sin reutilizar servidores existentes. No ejecutar `bun test tests/integration` ni `playwright test` directamente: los guards exigen el stack gestionado y rechazan los puertos de desarrollo. Si se interrumpe el proceso abruptamente, un stack temporal puede permanecer en Docker; el runner imprime el project ID y ruta si falla la limpieza para poder detener **solo ese proyecto** con `supabase stop --project-id <id> --workdir <ruta> --no-backup`.

### Fixtures Auth de Fase 1

`tests/fixtures/setup-auth.ts` crea identidades confirmadas mediante la Admin API y perfiles internos deterministas para ADMIN, INSTRUCTOR, multirol y DISABLED, además de una identidad desconocida. Las credenciales son datos ficticios exclusivos de test. Cada runner consulta URL y keys de su proyecto temporal con `supabase status --output env` sin imprimirlas. Una service-role key temporal se usa únicamente en procesos de test y en el proceso servidor E2E aislado; nunca llega al browser.

`bun run test:e2e` usa un runner que inyecta URL/keys del stack aislado y `TEST_DATABASE_URL` únicamente al proceso Playwright. El Playwright config pasa su service-role key temporal como `SUPABASE_SERVICE_ROLE_KEY` al proceso dedicado del web server E2E para que el endpoint autenticado de artwork pueda escribir en Storage; no se entrega a páginas/navegador. Los tests generan enlaces de un solo uso mediante Admin API y canjean el token con el adaptador cookie oficial de SSR, sin ofrecer login por email en `/login` ni visitar Google. El seed de desarrollo y los fixtures de test permanecen separados.

La cobertura de Auth incluye redirects no autenticados, roles individuales y múltiples, denegación por URL directa, identidad deshabilitada/desconocida, vinculación y restricciones DB, y cierre de solamente la sesión actual.

También se verifica signup público deshabilitado, creación de fixture por Admin API, usuario activo sin roles, motivos exactos de denegación, políticas fail-closed, opciones de cookies, cache privado, origen de acciones Auth, reemplazo exacto de roles y vinculación concurrente. Los escenarios server-side se ejecutan una vez en Chromium desktop; mobile conserva únicamente Foundation y un smoke de navegación privada.

### Cobertura de autenticación dual (Fase 4, integrada mediante PR 118)

Las pruebas añadidas en la rama `feat/dual-auth-and-profile` cubren login password solo para cuenta interna autorizada, rechazo de identidad/método no permitido, validación de sesión actual con `getUser()` y claims firmados, provisión interna de instructor con autorización ADMIN/transacción/compensación, cambio/recovery de contraseña, asociación Google explícita ligada al actor y sesión, PKCE, nonce de un uso/expiración, mismatch de email/provider, identidades Google preexistentes y restauración de la sesión original. Los tests Google usan un fixture de provider OAuth aislado; no son login con Google real ni prueba de entrega de email.

Estado local comunicado por el implementador: unit 146 PASS, integration 71 PASS, 27 E2E dirigidos PASS; lint PASS; typecheck 0 errores/0 warnings/83 hints; build, Drizzle y formatter PASS; `git diff --check` PASS. Después, el full E2E aislado en el puerto canónico 4321 pasó 104/104 (5.9 min). La corrida full anterior en 4323 obtuvo 73 PASS/31 FAIL: tests heredados enviaban `Origin: http://127.0.0.1:4321` y sus POST fueron rechazados como cross-site. Se corrigió solo la invocación al puerto canónico, sin editar código/tests ni modificar retries; el puerto alternativo aún no cubre todos los tests heredados.

[PR 118](https://github.com/SteveCasTo/skillbase/pull/118) se integró en `development` como `f06b4fdf8f8c7691ffdd7937efb0f813a27666d4`. No reportó checks remotos; estos resultados son locales, no CI PASS. En ese momento 0012/0013 solo se habían probado en stacks aislados; su aplicación local posterior y 0014/0015 constan abajo. Cloud, SMTP/entrega real y Google real siguen sin verificarse. El servidor original estuvo apagado durante esa validación histórica; el smoke local posterior está registrado en la sección de PR 123.

### Cobertura de perfiles/asignación de instructor (PR 120)

La cobertura añadida en `tests/unit/instructors.test.ts`, `tests/integration/instructors.test.ts` y `tests/e2e/instructors.spec.ts` valida perfiles/normalización, creación server-side de cuenta y perfil, edición propia/ADMIN, campo email no editable, actor/rol, unicidad y restricciones, asignación obligatoria para publicar pero opcional en borrador, denegación por URL/curso ajeno, historial/auditoría, cambio de instructor antes del inicio y rechazo al comenzar, y fechas/calendarios de grupos concurrentes. Los E2E también cubren tarjeta completa, rutas responsive/teclado, validación accesible/estados de submit y fallback HTML sin JavaScript. La suite usa Supabase temporal; no prueba SMTP, Google real ni estado de migraciones del stack persistente.

Resultados locales reportados para PR 120: 151 unit PASS, 84 integration PASS, full E2E 107/107 PASS en `127.0.0.1:4321`, lint/format/typecheck/build y Drizzle checks PASS. No se reportaron checks remotos para PR 120. En esa etapa 0012–0014 estaban solo en stacks aislados; después se aplicaron al local estándar y cloud vía PR 126.

### Seed local, auditoría password y reparación forward-only (PRs 121–123)

`tests/integration/renew-demo.test.ts` ejercita el seed/reset sobre Supabase temporal: preserva la identidad Auth, rol y sesión del ADMIN; crea/recupera las mismas tres identidades instructor; hace insert-only sin sobrescribir cursos; y se niega ante metadata de ownership alterada. `tests/integration/auth-repository.test.ts`/`tests/unit/dual-auth.test.ts` cubren `PASSWORD_CHANGED` sin password ni token y el comportamiento cuando la escritura de auditoría falla después de que Supabase Auth ya aceptó el password. `tests/integration/format-deletion-guard.test.ts` valida que revisiones de formato sean inmutables y que solo se eliminen las revisiones de un formato explícitamente autorizado y no referenciado.

Seed local verificado por el implementador: 2 formatos/revisiones, 3 perfiles/cuentas instructor, 6 cursos (5 publicados/1 draft), 12 grupos, 6 historiales de asignación, 35 interesados (30 `ACTIVE`, 5 `CANCELLED`) y 6 marcadores `DEMO_SEEDED`. Los tres instructores autenticaron por password y cada uno vio sus dos cursos propios; las rutas/consultas ADMIN fueron denegadas y las sesiones temporales se cerraron. Los reruns insert-only conservaron cursos/filas existentes. Ninguna contraseña/clave se imprime.

`bun run test:integration:renew-demo` usa únicamente un stack Supabase temporal. El CLI `bun run db:seed:renew-demo` es manual y local-only: sin flags muestra el plan, `--apply` inserta faltantes y `--apply --reset-application-data` resetea solo su allowlist app-data con `TRUNCATE ... RESTRICT`. La CLI no es parte de tests ni puede dirigirse a producción.

PR 123 reparó mediante 0015 el guard de borrado de revisiones observado en el Supabase local estándar. Ledger 16, 0012–0015 aplicadas sin reset; checksums históricos de 0003/0005/0008 quedaron intactos. No se modificaron migraciones históricas. El detalle del drift probado y del guard actual está en `docs/DEPLOYMENT.md`.

Validación local final reportada tras PR 123: 154 unit PASS (1123 assertions), 87 integration PASS (615 assertions), full E2E 107/107 PASS en el puerto canónico `127.0.0.1:4321`, lint/format/build/Drizzle y `git diff --check` PASS; typecheck 0 errores/0 warnings/98 hints. Una corrida E2E anterior a la reparación de Sharp falló 87/107 con error real de procesamiento de imagen; la dependencia opcional Sharp faltante se restauró con `bun install --frozen-lockfile`, sin cambio de código/manifest. La corrida posterior de la fuente corregida pasó 107/107, no fue retry de la fuente fallida. No hay checks remotos reportados.

Smoke frontend local final PASS en `http://127.0.0.1:4321` (PID 23168): catálogo 5 tarjetas, detalles y formulario/preferencias 200; el curso público muestra nombre completo del instructor, sin email/teléfono. Los perfiles synthetic INSTRUCTOR y dos cursos/detalles propios dieron 200; las rutas ADMIN desde sesión INSTRUCTOR fueron denegadas 303. Se cerraron las sesiones temporales. El proceso quedó activo para la comprobación coordinada; no detenerlo. Google OAuth real, SMTP/recovery cloud y production smoke siguen sin verificarse.

### Verificación del release PR 126 en producción

CI master run [`36951624627`](https://github.com/SteveCasTo/skillbase/actions/runs/36951624627) pasó los jobs requeridos `quality`, `integration-e2e` y `deploy`; full E2E 107/107. En una corrida anterior del PR hubo dos pruebas flaky; no se afirma que nunca hayan ocurrido flakes. El release desplegó commit `31623e708b1b3cef64d48c7ab3bdd17fec2bd394` mediante Vercel deployment `dpl_8d1Fd13g7s4CXE3VSMH21fbS1ysz`, `READY`, alias `https://skillbase-alpha.vercel.app`.

Supabase cloud canónico `fvzxqlezdrlzykyoevub` quedó `ACTIVE_HEALTHY` con ledger 0012–0015 y hashes/timestamps alineados al repo; RLS y privilegios restringidos de Auth/instructor/historial verificados. La renovación manual de producción comprobó la preservación de Auth identities/sesiones/roles, ADMIN, perfiles, Storage y tablas técnicas y dejó 2 formatos/revisiones, 3 perfiles instructor, 6 cursos (5 publicados/1 draft), 12 grupos, 6 historiales, 35 interesados (30 activos/5 cancelados) y 6 marcadores demo. No se automatiza reset en deploy.

El smoke productivo revisó catálogo de 5 tarjetas, detalles, formulario/preferencias y nombre de instructor sin contactos; alta y duplicado de interesado respondieron 200 con el mismo mensaje neutro y `no-store`, y el seed de 35 interesados quedó intacto tras limpiar el registro sintético. Los buckets TTL persistieron. Tres logins de instructor por password vieron dos cursos propios cada uno; rutas ADMIN directas fueron denegadas con 303 y sesiones temporales cerradas. No se probó Google real/linking de identidad ni entrega SMTP/recovery; no declarar esos flujos verificados.

### Resumen de operación local

La suite temporal de seed/reset y guard de formato se detalla en los tests `renew-demo.test.ts` y `format-deletion-guard.test.ts`; la herramienta CLI de datos permanece separada y local-only (ver `docs/DEPLOYMENT.md`).

El comportamiento del guard forward-only 0015 y las diferencias históricas probadas se documentan en `docs/DEPLOYMENT.md`; la prueba del schema/función ocurre en stacks aislados, no contra cloud.

Los resultados y límites del gate de producción, distinto de esta validación local, se registran en `docs/PLAN.md` y `docs/DEPLOYMENT.md`.

### Cobertura de cursos y formatos

- Unit cubre validación de campos, niveles, dinero decimal, fechas civiles Bolivia estrictas y simétricas, ventana opcional, nota explícita —incluido cero—, slug, transiciones, autorización activa, logging sanitizado y disponibilidad derivada.
- Integration usa exclusivamente su Supabase temporal para verificar schema, checks, índices de FK/consulta, RLS, privilegios, rollback atómico, auditoría exacta, validación transaccional de precios, concurrencia de slugs solapados, revisión optimista, persistencia UTC y proyecciones públicas.
- E2E crea usuarios Auth de fixtures dentro de su stack temporal y recorre validación con valores preservados, creación, reedición sin desplazamiento horario, edición, publicación, retiro y archivo mediante Post/Redirect/Get. La gestión de formatos funciona sin JavaScript; el formulario de cursos usa islas React para selectores, fechas/calendario, horario y edición Markdown. También se verifica denegación a instructor, protección de origen, layout mobile sin overflow y foco por teclado.
- No se automatiza Google UI. Las rutas públicas de catálogo/detalle ya tienen pruebas E2E dedicadas.

La carga pública cuenta con unit tests deterministas para los tres intentos máximos, delays inyectados y exclusión de errores permanentes/configuración. La política de middleware prueba que las rutas públicas no inicializan Auth y que `/login`, `/auth/**` y `/app/**` conservan sus contextos requeridos.

### Cobertura de la landing Cartelera editorial

- `tests/unit/public-course-loader.test.ts` verifica la lectura pública tras fallos transitorios, los dos delays de reintento y el límite de tres intentos, además de no reintentar errores permanentes o de configuración.
- `tests/unit/course-poster-rows.test.ts` verifica listas vacías, remanentes de 1 a 4, tríos, la partición de cuatro elementos en dos pares, la conservación del orden y la alternancia de énfasis entre pares.
- `tests/e2e/landing-responsive.spec.ts` recorre 320, 390, 667, 768, 1024 y 1440 px; verifica ausencia de overflow, landmarks y foco, objetivos táctiles, breakpoints del header, temas oscuro/warm y art direction responsive.
- El mismo E2E verifica que el curso destacado y cada afiche secundario sean enlaces únicos de tarjeta completa, que la cartelera no exponga precios ni horario detallado, y que `count=8` preserve el orden con filas `3, 2, 2` en tablet y mobile.
- La regresión de `count=20` verifica 19 afiches secundarios, anchos utilizables y uniformes en mobile, un mínimo usable en tablet y ausencia de overflow después del cambio de layout.
- `previewCoursesForCount` limita el preview temporal al rango 1..20; las muestras sintéticas se marcan `noindex,nofollow`, no sustituyen fixtures de oferta real ni implican upload/storage administrativo.
- La compatibilidad con `prefers-reduced-motion` está implementada en la hoja de estilos de la landing: desactiva las animaciones y las transiciones/transformaciones decorativas principales de portada, cursos y CTA. Las pruebas E2E conservan la validación de contenido y navegación sin depender de animaciones.
- La fotografía de preview y su procedencia son material sintético de desarrollo. Tests unitarios cubren formato/key/dimensiones y tests E2E comprueban autorización/origen, subida y guardado reales en Storage local, visualización pública y limpieza del objeto de prueba. La cobertura de formatos y revisiones incluye persistencia, inmutabilidad, preservación histórica, asignación a borradores, activación y destacado singleton.

### Cobertura de formatos, catálogo y navegación

- `tests/unit/course-markdown.test.ts` cubre la conversión a nodos permitidos y el rechazo de destinos de enlaces peligrosos.
- Las pruebas unitarias del Markdown verifican niveles de encabezado, bloques de código, citas, separadores, selección del toolbar y enlaces seguros; `public-courses.spec.ts` comprueba la representación real de estos elementos en el detalle publicado. Los E2E de cursos comprueban la vista previa y la foto persistida dentro del bloque de información general en desktop y mobile.
- Los E2E de administración mantienen un marcador de `window` entre alta de formato/curso, cambios editoriales y eliminación con ClientRouter, verifican los diálogos de confirmación (teclado/Escape/foco), errores de servidor y reintentos de foto sin duplicar borradores. La suite sin JavaScript sigue probando POST/redirect y confirmaciones HTML.
- Las pruebas de integración de cursos cubren migración/modelo de formatos, términos y revisiones, cambios que actualizan borradores pero no publicaciones/archivados, precios históricos, y límite único del destacado publicado.
- `tests/e2e/public-courses.spec.ts` verifica SSR público, catálogo/detalle, estados y 404 uniforme; `tests/e2e/courses.spec.ts` amplía los flujos administrativos de formato, contenido, imagen y autorización. `tests/e2e/private-sidebar.spec.ts` cubre rail/overlay, roles, scroll independiente, teclado y movimiento reducido, ubicación/alineación y foco del control de cerrar sesión, y la acción única de crear curso en la cabecera de Cursos.
- `tests/e2e/private-mobile.spec.ts` comprueba la transición de entrada y salida del menú móvil, cierre accesible, movimiento reducido y ubicación a la izquierda del control de sesión. Las pruebas de formatos y cursos verifican que sus guardados con JavaScript conservan la página y los valores sin recarga, actualizan revisiones para ediciones sucesivas y siguen mostrando errores; las pruebas sin JavaScript mantienen el POST HTML.
- Cada ejecución de integración y E2E recibe una instancia Supabase temporal independiente; la inicialización/limpieza ocurre en el runner y ningún fixture se prepara sobre la base de desarrollo. E2E conserva `workers: 1` y `fullyParallel: false` para mantener deterministas los escenarios secuenciales y el destacado singleton dentro de esa ejecución.
- `tests/e2e/formats-interactive.spec.ts` verifica que el alta de formato mantenga deshabilitado el submit hasta que todos los valores obligatorios sean válidos, filtros de escritura/pegado/arrastre, edición en línea con controles de icono dentro de la misma fila y cancelación sin navegación, y confirmación explícita de borrado; también comprueba que el servidor rechace valores inválidos y revisiones obsoletas. `tests/e2e/courses-no-js.spec.ts` recorre creación, edición y borrado de formatos sin JavaScript, con fallback de confirmación visible y validación HTML/servidor.
- El detalle de formatos prueba la acción contextual según uso, el diálogo con teclado/Escape y el conflicto optimista; activar, desactivar y eliminar mantienen la página con JavaScript. `toast-theme.spec.ts` comprueba superficie y texto del toast en claro y oscuro además de los tokens semánticos.
- La suite verifica creación/detalle de formatos, navegación mediante tarjetas, edición de un campo por acción optimista, rechazo de revisiones obsoletas, activación/desactivación y borrado solo de formatos sin cursos asociados. Cursos E2E cubren controles separados de fecha/hora civil, planificación L–V para cursos nuevos y horario textual para los históricos, toolbar Markdown, selección y recorte de artwork antes de crear el borrador con carga y asociación autorizadas después de crearlo (incluido reintento sin duplicación), proporción real 8:5, zoom y arrastre que invalida la confirmación previa, reemplazo accesible sobre la foto guardada en desktop y mobile, gating de «Crear borrador» por validez y presencia de campos requeridos, conservación habilitada frente a cambios opcionales, filtro de entradas de nota/fecha/hora, y guardado deshabilitado cuando no hay diferencias (con JavaScript). También cubren confirmaciones transitorias Sileo; el componente sincroniza tema y la suite de sidebar verifica presentación de navegación/cierre de sesión.
- El planificador de lunes a viernes tiene tests unitarios para redondeo, fines de semana, horario Bolivia, fechas inválidas y sesiones nocturnas; integración verifica revisiones de formatos, propagación a borradores y backfill conservador de valores históricos. E2E comprueba el quinto dato del formato, calendario/horas derivadas, inicio de curso nuevo y el flujo HTML sin JavaScript. Los cursos históricos siguen aceptando su horario informativo sin convertirlo a sesiones.
- `group-repository.test.ts` verifica cupos, concurrencia entre altas/ediciones del mismo curso, horarios contiguos válidos, cancelación auditada y preservación de la revisión vinculada; rechaza edición del calendario de un curso con grupos y cambios sobre grupos cancelados. `groups.spec.ts` y `groups-no-js.spec.ts` prueban autorización/origen/ownership, validación, modal con foco y Escape, rutas móviles, ausencia de recarga con JavaScript y fallback HTML explícito.
- La existencia de cobertura en el árbol no acredita por sí sola ejecución reciente de la suite, CI remoto, aplicación de migraciones cloud ni despliegue. Esos resultados se anotan solo después de ejecutarlos/verificarlos.

### Fixtures heredados en Supabase local

Una versión anterior de las pruebas utilizaba la base local compartida y podía dejar fixtures o afectar datos locales durante su preparación. Las suites actuales ya no acceden a ese stack. Si se quiere eliminar los perfiles/Auth sintéticos heredados de un Supabase local existente, ejecutar `bun run db:cleanup:legacy-test`; el comando comprueba que la conexión sea la instancia Supabase local en ejecución, coincide perfiles por correo y nombre exactos, y elimina solo esos perfiles e identidades. No elimina cursos, formatos ni eventos de auditoría y **no restaura ni recupera ningún dato eliminado con anterioridad**. No ejecutar `db:reset` como medida de limpieza de tests: reinicia destructivamente toda la base local.

### Resultado de cierre de Fase 2A

- Fase 2A superó sus pruebas unitarias, de integración y E2E en local y CI.
- Typecheck, build y advisors de Supabase se verificaron antes de cerrar el gate.
- La cobertura nueva de la landing pertenece al avance parcial de Fase 2B y no implica que catálogo, detalle ni el gate completo de esa fase estén cerrados.

## GATES

No desplegar `master` si falla:

- lint;
- typecheck;
- tests obligatorios;
- build.

Un fallo de CI debe considerarse bloqueo de release.

### Avance local de navegación privada y recuperabilidad

Hay cobertura unitaria nueva para resultado de mutaciones, idempotencia/recuperación de alta y skeleton de navegación, además de escenarios E2E para cursos, grupos, formatos, tema, sidebar, mobile y skeleton. Estado final local comunicado: full unit 108 PASS; full integration 54 PASS; lint PASS; typecheck PASS con 0 errores y 47 hints (también PASS en full-check posterior a notifications); build PASS a las 20:55; `drizzle-kit check`, schema checks, formatter de archivos modificados y `git diff --check` PASS. E2E: el primer full run fue 76/82; tras corregir cinco selectores y un ID de biblioteca, el rerun full fue 81/82 con un fallo en el selector toast de `public-courses`. El test dirigido `public-courses` pasó 4/4, incluyendo el escenario que falló en el full run. Por tanto, existe cobertura colectiva de los 82 escenarios, pero no se declara un full run 82/82.

Las notificaciones administrativas pasan por `src/lib/notifications.ts`: cada operación obtiene un ID UUID independiente, y `promise` conserva el mismo ID entre loading/success/error. El bridge adapta en tipos estrictos el `id` que Sileo 0.1.5 consume en runtime pero no declara; no se usa `any` ni un patch en `node_modules`.

La migración `0010_course_creation_receipts` se aplicó a la base Supabase local estándar en `127.0.0.1:54322` mediante `bun run db:migrate`, sin reset y preservando los datos existentes. No se aplicó en cloud. Los stacks temporales de integración/E2E siguen teniendo su ciclo aislado e independiente.

### Cobertura de interesados (Fase 3)

Se añadieron pruebas unitarias en `tests/unit/interests.test.ts`, `interests-admin-presentation.test.ts`, `public-interest-presentation.test.ts` y `public-interest-form-ssr.test.tsx`; integración del repositorio en `tests/integration/interests.test.ts`; E2E público y administrativo en `tests/e2e/public-interest.spec.ts` y `interests-admin.spec.ts`. Cubren contrato, presentación, persistencia, autorización, rate limit y flujos UI según sus escenarios. PR 105 se integró en `development` como `0bf0979`; los resultados locales no implican CI/cloud.

La corrección acotada de interesados amplía unit tests para proporciones de demanda, empates positivos/cero, submit SSR habilitado y rutas de skeleton. Los E2E conservan las assertions de autorización, revisión optimista, cancelación/reactivación, duplicado neutro y POST sin JavaScript, y añaden tarjetas/barras responsive en 320, 390, 768, 1024 y 1440 px, gating de campos obligatorios, submit de ancho completo y navegación pendiente real. Estas adiciones deben ejecutarse en el runner aislado/CI; no ejecutar E2E local mientras el servidor del usuario ocupe 4321, ni reutilizarlo como servidor de pruebas.

Verificación local de esta corrección: 133 unit tests PASS (853 assertions), lint y format check global PASS, typecheck con 0 errores/0 warnings/70 hints y build PASS. Chromium aislado en 4437 verificó componentes y CSS reales con DTO sintético en los cinco anchos y ambos temas, barras/empates/cero, confirmación por teclado, revisión/conteos reconciliados con respuestas simuladas, gating, pending/error/reintento, baseline HTML sin JavaScript y skeleton durante un GET realmente pendiente del ClientRouter. No se ejecutaron integration ni E2E completos, ni se accedió a DB; las respuestas simuladas no acreditan contratos HTTP/Auth. El servidor, fixture temporal y scripts de esta comprobación se retiraron al terminar.

#### Cierre posterior del ajuste de interesados (PRs 116 y 117)

PRs 116 y 117 integraron en `development` la corrección compacta/responsive del panel y formulario, junto con la cobertura de rutas/skeleton y navegación/Auth incorporada en esos cambios. La verificación completa posterior de la UI pasó 98/98 E2E; el registro de calidad asociado reportó 133 unitarias y 65 de integración. Estos resultados posteriores superseden para el estado actual las notas anteriores de verificación aislada/local que indicaban integración/E2E pendientes; se conservan arriba como secuencia histórica de pruebas. El full posterior con Auth dual pasó 104/104, según el registro de PR 118 arriba; no se suman corridas como si fueran una suite única.

Resultados locales finales comunicados para Fase 3: full unit 129 PASS (793 assertions); full integration 65 PASS/0 FAIL (478 assertions, 9 archivos); lint global PASS; typecheck 0 errores, 0 warnings y 70 hints; build y Drizzle checks PASS. El primer full integration run fue 45/66 por cleanup de fixtures de cursos incompatible con la FK de `interest_registrations`; se corrigió truncando explícitamente la tabla de interesados, sin `CASCADE`, y el full rerun pasó.

E2E: corrida full 81/95 PASS y 14 fallos vinculados a fixtures (12 calendarios de cursos que respondían 422 y 2 cargas de formatos). Sin cambios posteriores de código productivo, las suites dirigidas `courses` pasaron 2/2 (47.9 s) e `interests` 13/13 (1.1 min), con un escenario Auth solapado. Se registran los 95 escenarios cubiertos por combinación de corrida full y revalidaciones dirigidas; no se afirma un full run 95/95. Fallback sin JavaScript y navegación/animación mobile pasan; JavaScript de la aplicación no se deshabilita.

La migración 0011 se aplicó en los stacks aislados de tests y después, sin reset, al Supabase local estándar `127.0.0.1:54322`. El rerun local fue idempotente: checksum `377bb93ab34a1e9745ff69823ee065f11183b7db7f5881337dedd99e9dfa72b6`, ledger 11→12, ambas tablas nuevas con RLS; se conservaron 7 cursos, 9 grupos, 1 usuario y 34 eventos de auditoría. Un smoke local obtuvo 200 para `/`, `/cursos` y curso demo; dos POST sintéticos devolvieron 200 neutro/`no-store`. Rate limit utilizó loopback e ignoró un header forwarded falsificado. Se eliminaron los registros sintéticos: quedan 0 interesados y 2 buckets técnicos con TTL. El secreto local está configurado únicamente en `.env` ignorado; no documentar su valor. El servidor de desarrollo quedó activo en `http://127.0.0.1:4321`.

La operación cloud verificó presencia de `INTEREST_RATE_LIMIT_SECRET` en Vercel Production y Preview sin leer ni registrar el valor, así como la cadena estática Vercel → Astro/Vercel `Astro.clientAddress` → `net.isIP`. El deployment de producción y las migraciones cloud se validaron después en el release descrito a continuación; Preview sigue sin credenciales DB ni deployment funcional.

### CI y smoke de producción (release Fase 3)

PR 112 (corrección de tests de auditoría sin supuesto de orden) pasó `quality` e `integration-e2e` en CI run `36827391089`. Tras mergear PR 113 a `master`, CI run `36828194127` pasó `quality`, `integration-e2e` y `deploy`. La integración completa fue 65/65 y E2E 96/96, sin flaky tests. Las assertions de auditoría validan conteo/conjunto de eventos y actor/entidad/metadata; no dependen del orden incidental de filas SQL.

En producción, los GET de landing, catálogo y detalle/formulario devolvieron 200; alta y duplicado devolvieron el mismo cuerpo neutro 200 con `Cache-Control: no-store` y solo quedó un interesado. Dos requests con `X-Forwarded-For` falsificado compartieron los mismos buckets de red y curso (contador 2 por scope), lo que confirma que el header no sustituye la dirección confiable. No fue un stress para forzar 429 ni una comprobación del HMAC sobre IP real. Se borró el único registro sintético; persistieron 0 filas de interés y 2 buckets técnicos con TTL. `/app/interesados` sin sesión redirigió a login con 303; no se realizó una interacción manual como ADMIN en producción.

Las regresiones E2E de esta entrega también verifican un único host/viewport de notificaciones visible entre shared/private layouts (incluida hidratación previa al host), toast sin tapar acciones superiores y lista de cursos con slugs largos sin overflow en 320, 390, 768, 1024 y 1440 px. El menú móvil conserva su animación y el fallback sin JavaScript pasa; la aplicación no deshabilita JavaScript.

### Gate de correcciones de Fase 4 (rama fuente `fix/phase4-lifecycle-guards`)

La evidencia comunicada para `ba1dccce4569649b77f5ef0e311d740b53bbb2ac` (rama basada en `development` `e6e64f1`) cubrió correcciones de formularios Auth, responsive, interesados, asignación/grupos y lifecycle. En la corrida local de esa fuente: unit **176 PASS**, integration **98 PASS**, full E2E **119/119 PASS** en `127.0.0.1:4321`, sin retries automáticos; lint, formatter, build, Drizzle checks y `git diff --check` PASS; typecheck **0 errores/0 warnings**. Esta es evidencia histórica de esa fuente, no del árbol port-fix final ni de CI/prod.

Lifecycle se integró mediante PR 134 (`b1855b1`), los puertos por PR 135 (`ddd0f3d`) y el fix de hidratación/context final por PR 136 (`8cdb38f`). La integración Git no se toma como evidencia de CI remoto; abajo se anotan las pruebas locales reportadas. El worktree de documentación continúa deliberadamente basado en `e6e64f1`, anterior a estos PRs; no se rebaseó ni se fusionó para preservar sus cambios locales.

Cronología E2E preservada: una ejecución anterior pasó 111/118 y la siguiente 116/119; los fallos encontrados fueron defects/fixtures concretos de reglas de publicación (fixtures sin el grupo mínimo), conservación de `null` del instructor en fallback HTML, selectores duplicados, aislamiento del presupuesto de login por red y expectativas móviles de posición de controles. Se corrigieron en la fuente y el resultado final fue una corrida full 119/119, sin retries automáticos. No se eliminaron tests ni se redujeron assertions/cobertura para hacer pasar la suite.

El E2E cubre lifecycle ADMIN completo, perfil sin JavaScript, autorización desde sesión instructor ya abierta tras desactivación, reactivación conservando credenciales, eliminación de cuenta nunca asignada, bloqueo con cursos asignados, progreso/error inline y no duplicación de POST. También cubre formularios de password/recovery y Google-only, orden móvil de theme/logout, perfil, cambios parciales de filtros de interesados, duplicado neutro, reglas de draft/publicación/último grupo y fallback SSR. Estos escenarios corren sobre stacks temporales y no sustituyen pruebas contra servicios externos reales.

#### Migraciones y release

La migración `0016_instructor_lifecycle_outbox` se aplicó en los stacks temporales y después al Supabase local estándar, sin reset. En este stage su ledger pasó de 16 a 17; cloud aún permanecía en 16. No se afirma aplicación cloud, CI remoto PASS, SMTP propio, entrega de recovery ni Google OAuth real para esta validación histórica.

#### Cambio de puertos y smoke local (PR 135)

PR 135 (`ddd0f3d`) trasladó Supabase local desde API/Auth `127.0.0.1:54321` y PostgreSQL `127.0.0.1:54322` a API/Auth `127.0.0.1:55321` y PostgreSQL `127.0.0.1:55322`, porque Windows reservó `54296–54395`. Astro sigue en `127.0.0.1:4321`. Validaciones reportadas para PR 135: 177 unit, un test aislado de integración de puertos, quality y build PASS.

Después de mover puertos, `bun run db:migrate` aplicó 0016 normalmente a la base local estándar: ledger 16→17. No se hizo reset. Se conservaron Auth identities, ADMIN/roles/perfiles, sesiones, Storage, seis cursos y 35 interesados. Las diferencias esperadas observadas fueron la fila del ledger y el timestamp de inicio de sesión del usuario sintético del smoke. Smoke local PASS: seis rutas/páginas públicas y siete solicitudes de detalle/formulario/imagen; páginas de cursos propios del instructor, perfil y password 200; rutas ADMIN 303. Se cerró la sesión temporal. En el smoke el servidor Astro existente estaba activo en `127.0.0.1:4321`; esto no describe su PID/estado actual después de las corridas posteriores.

Este smoke no prueba Google OAuth real ni entrega de recovery. El callback local actualizado `http://127.0.0.1:55321/auth/v1/callback` requiere allowlist manual en Google Console; no se afirma que ese cambio externo se haya realizado. En ese momento, la producción seguía en el release previo de Fase 4 (`master` `598b1f`, migraciones hasta 0015, ledger 16), sin escritura cloud ni deployment desde esta validación; el release posterior de Fase 5 se registra abajo.

PR 136 (`8cdb38f`) integró el fix final de middleware request-context e hidratación SSR de password. El commit fuente validado `8735d676fe0d96e7230b4636efa8cb51045d1eca` (base `ddd0f3de`, 0 behind/1 ahead) pasó unit **178**, integration **98** y canonical full E2E **120/120**, además de lint, formatter, typecheck (0 errores/0 warnings), build, Drizzle y diff checks. No se informaron warnings/errores de hidratación `Astro.session`/React. La fuente explícita de request context evita expandir getters Astro en middleware; password controlled-state queda coherente antes/después de hidratar y se añade cobertura `request-client-context`/`password-hydration`. No se suprimieron warnings globalmente.

El install directo previo falló por el estado de paquetes del entorno; `bun install --frozen-lockfile` restauró dependencias sin editar `package.json`/`bun.lock` ni cambiar la versión de Astro. No se clasifica como flaky de producto. PR 136 ya está integrado en `development`; la verificación anterior 119/119 y esta final 120/120 son runs separados de distintos trees, no se suman ni se afirma retry automático para el run final.

### Fase 5: validación local y release (development)

- PR 173 incorporó foundation/migración 0017; quedó aplicada sin reset al Supabase local estándar y ledger 18. La verificación de preservación registró seis cursos, 35 interesados y cero preinscripciones; no se cargaron datos financieros/fixtures de participantes ni pagos.
- PR 177 reportó **291 unit**, **125 integration** y quality PASS para la capa compartida de UI/settings integrada. PR 178 reportó **295 unit** y quality PASS para settings HTTP; en ese stage faltaba completar su route policy/UI.
- PR 175 integra generadores CSV/PDF; PR 176 agrega aplicación/repositorio transaccional. Los resultados unit/integration anteriores no equivalen al gate combinado final de pantallas HTTP.
- PR 179 (`d13432d`) integró páginas HTTP de preinscripción/participante, exportes, roster y route policy. La rama UI reportó 34 tests dirigidos y tres E2E (dos escenarios principales y un harness temporal) PASS; después pasó el full canonical descrito abajo.
- En `development` están integrados schema, operaciones de aplicación/repository, settings y páginas/listado/alta/detalle, acciones de efectivo/devolución/transfer/cancelación, export endpoint y roster. `/app/configuracion` ya está en `PRIVATE_ROUTE_POLICIES` y protegida ADMIN.

La migración 0017 está aplicada al Supabase local estándar (`127.0.0.1:55322`) y al cloud para el release Fase 5 (`2e0eecb`, cloud ledger 18). El gate local reportado fue 303 unit, 125 integration y E2E 125/125. Esto no prueba Google OAuth real, autorización del callback local en Google Console ni SMTP/entrega de recovery; las dos tareas operacionales continúan independientes.

#### Resultados parciales por PR y stage de interfaz

- PR 177 reportó 291 unit, 125 integration y quality PASS para la integración de componentes UI/settings compartidos; son resultados de ese stage y no full E2E del flujo completo.
- PR 178 reportó 295 unit y quality PASS para settings HTTP; PR 179 agregó e integró la policy/rutas que habilitan la interfaz.
- La rama/stage UI basada en `7d164f1` reportó 34 pruebas dirigidas PASS, tres E2E focales (dos casos principales más un harness temporal) y quality PASS.
- El full gate final se ejecutó en commit `25890143` e integró mediante PR 180 (`917a636`): **303 unit, 125 integration, canonical E2E 125/125**. Corrida inicial E2E: 119/125; seis fallos SSR 500/settings browser-only/hidratación se corrigieron y el run final pasó sin retries. Quality: 0 errores/0 warnings; revisión visual: 24 screenshots en 375/768/1440 px, light/dark, sin overflow. Esta documentación no ejecutó ni repitió tests.

La aplicación local/migración 0017 no introdujo datos de prueba financieros: quedaron cero preinscripciones en ese baseline; se conservaron seis cursos y 35 interesados. El release posterior a producción está registrado como `2e0eecb`; esta evidencia local no equivale por sí sola a un smoke manual de todos los flujos de producción.
