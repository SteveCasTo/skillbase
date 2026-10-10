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

Los escenarios de `google-association.spec.ts` preparan su presupuesto de login
por red loopback en la DB temporal antes de cada caso, sin borrar buckets por
cuenta ni modificar el límite runtime (10 intentos por ventana de 15 minutos).
El helper limpia únicamente la clave HMAC exacta de `network:127.0.0.1:login`;
no omite rate limiting ni altera la protección aplicada en producción. El caso
Google-only ADMIN crea una identidad Auth/internal user exclusiva por intento,
sin identidad Email/password, con el campo de password en Auth vacío y una
identidad Google de fixture. Su cleanup deshabilita solo el internal user propio
y elimina solo su UUID Auth; conserva UUIDs/roles/evidencia interna hasta que el
runner destruye su stack aislado. No modifica el ADMIN compartido, sus credenciales
ni evidencia histórica de otros actores. Una identidad nueva por intento evita
que un retry acumule identidades Google sobre el mismo fixture.

El release-validation CI `37720672015` tuvo 138/139 first-pass; el escenario
Google-only falló también en ambos retries automáticos. No hubo trace del primer
intento disponible en el artefacto entregado; el trace del retry mostró un
conflicto de identidad secundario del fixture, no la causa del primer fallo. La
reproducción controlada dio 8/9: los escenarios previos consumen 10 requests del
bucket loopback compartido y el login final incrementaba a 11, siendo rechazado
por el límite antes de llegar a Auth. Por ello no se atribuye la primera failure
al password ni a estado/role inválidos; tampoco se afirma la intercalación exacta
del primer paquete, cuyo trace no existe.

Con la corrección test-only, el focused Google-association cohort pasó 9/9
first-pass sin retries; el caso Google-only repetido sobre stack manejado pasó
2/2 first-pass, usando una identidad Auth propiedad de cada intento. El límite de
runtime permanece intacto y estas corridas no prueban Google OAuth real, SMTP ni
entrega cloud. Evidencia/progresión de intentos en el handoff local
`C:/Users/Steve/AppData/Local/Temp/opencode/phase8-release-ci/recovery-isolation-ledger.md`.

La corrección cambia fixtures/helpers E2E únicamente; no cambia código de Auth,
políticas runtime, límites, aplicación, roles, migraciones o dependencias. No se
repitieron unit/integration/build completos para este ajuste. Un focused pass no
sustituye el nuevo CI full de release: el gate integrado sigue bloqueado hasta
que el nuevo E2E CI pase sin fallos/retries y el resto de checks requeridos quede
verde.

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
- En ese boundary histórico, la cobertura de landing solo era avance parcial y no implicaba gate completo 2B. La verificación local posterior de esa fase fue full E2E 81/82 más public-courses dirigida 4/4; no se afirma una sola corrida 82/82. PR 113 y releases posteriores verificaron en producción landing, catálogo y detalle; el CI del release F9 final también es evidencia actual de regresión. Esto respalda rutas vigentes, pero no convierte retroactivamente el gate 2B en un cierre independiente ni borra el fallo/flakiness original.

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

La migración 0017 está aplicada al Supabase local estándar (`127.0.0.1:55322`) y al cloud para el release Fase 5 (`2e0eecb`, cloud ledger 18). El gate local reportado fue 303 unit, 125 integration y E2E 125/125. Ese gate de release no prueba Google OAuth real ni autorización del callback local; SMTP se configuró posteriormente y su evidencia/alcance se registra abajo.

#### Resultados parciales por PR y stage de interfaz

- PR 177 reportó 291 unit, 125 integration y quality PASS para la integración de componentes UI/settings compartidos; son resultados de ese stage y no full E2E del flujo completo.
- PR 178 reportó 295 unit y quality PASS para settings HTTP; PR 179 agregó e integró la policy/rutas que habilitan la interfaz.
- La rama/stage UI basada en `7d164f1` reportó 34 pruebas dirigidas PASS, tres E2E focales (dos casos principales más un harness temporal) y quality PASS.
- El full gate final se ejecutó en commit `25890143` e integró mediante PR 180 (`917a636`): **303 unit, 125 integration, canonical E2E 125/125**. Corrida inicial E2E: 119/125; seis fallos SSR 500/settings browser-only/hidratación se corrigieron y el run final pasó sin retries. Quality: 0 errores/0 warnings; revisión visual: 24 screenshots en 375/768/1440 px, light/dark, sin overflow. Esta documentación no ejecutó ni repitió tests.

La aplicación local/migración 0017 no introdujo datos de prueba financieros: quedaron cero preinscripciones en ese baseline; se conservaron seis cursos y 35 interesados. El release posterior a producción está registrado como `2e0eecb`; esta evidencia local no equivale por sí sola a un smoke manual de todos los flujos de producción.

### Correcciones de Fase 5 y Fase 6 (development; gate combinado pendiente)

PR 196 añadió configuración SMTP privada/plantilla; PRs 197–199 integraron los ajustes de administración e interesados; PRs 200–202 añadieron runner demo financiero/asistencia y PR 203 integró UI de sesiones/asistencia. User confirmó recepción de un correo de prueba local; esto no verifica clic/recovery, delivery cloud ni Google OAuth.

Las migraciones 0018/0019 se aplicaron al Supabase local canónico hasta ledger 20, preservando las 53 tablas existentes. Cloud/`master` permanecen en Fase 5/ledger 18. Cobertura focal reportada por los cambios: backend de asistencia 12 unit + 12 integration; UI y correcciones 15 UI + 5 mock + 1 caso de feriado; runner demo 3 unit + 1 integración aislada. Estos resultados dirigidos no son un full gate combinado.

PLAN verificó target/proyecto y provenance sin escrituras; el APPLY local posterior quedó confirmado sobre el árbol limpio `6813a4c`. Agregó 5 cursos, 10 grupos, 15 registros, 12 movimientos, 28 sesiones, 16 marcas de participante y 4 de instructor. Totales actuales: 12 cursos, 23 grupos, 16 registros y 13 movimientos; incluyen y preservan las filas previas. Se comprobaron escenarios financieros pagados/parciales/gratis, devoluciones y transferencia; asistencia PRESENT/ABSENT/EXCUSED, N=3 con aviso y restricción en N+1, revisión histórica pendiente, sesión de hoy sin marca, cancelación y reemplazos de 90 minutos. Ledger 20 y Auth/perfiles/roles/sesiones/settings/Storage previos quedaron intactos; la app original respondió HTTP 200. No hubo seed en cloud/producción. La evidencia de gate y de revisión visual se detalla a continuación; no hubo reinicio ni escrituras durante la validación visual.

#### Evidencia consolidada hasta PR 209

- El full unit/integration reportado pasó **332 unitarias y 137 integración** en `4b331ff9`. El backend de asistencia tuvo además sus 12 unit/12 integration focales PASS en su entrega.
- En el source de aplicación `b681a365`, el full E2E ejecutó **126 PASS / 1 FAIL de 127**. El único fallo fue un strict locator del test sin JavaScript; no se documenta como fallo de producto corregido mediante retry.
- PR 209 (`082dbbf`, test-only) corrigió ese locator. El escenario afectado se reejecutó focalmente y pasó 1/1, sin retry. En conjunto hay evidencia de los escenarios, pero no un full run único 127/127.
- Build, Drizzle y quality pasaron en `b681a365`; typecheck registró cero errores, cero warnings y 204 hints. La última UI/source de pruebas es `development` `082dbbf`.
- Revisión visual final sobre `development` `082dbbf` / app `b681a365`: seis vistas en 375 y 1440 px, light/dark, sin overflow; foco visible, diálogo cierra con Escape y devuelve foco al disparador; estado de asistencia N=3/inelegibilidad desde 4; instructor sin contactos/finanzas; sesión ajena devuelve 404; cero errores ni warnings de consola.
- El gate local queda validado mediante esta evidencia por heads: full E2E 126/127 y escenario sin JavaScript corregido por PR 209 con ejecución focal 1/1 PASS, sin retry; unit/integration 332/137 PASS; build/Drizzle/quality PASS y typecheck 0 errores/0 warnings/204 hints. No se afirma un full E2E único 127/127. CI/release cloud/master sigue pendiente.
- Se capturó un snapshot canónico pre-visual de 39 tablas con ledger 20. La comparación hash posterior quedó bloqueada porque Docker Desktop no estaba disponible. No se reinició Docker/Supabase ni se escribieron datos para la verificación visual; por tanto, no se afirma una comparación íntegra post-visual. Esto no invalida el snapshot de preservación del APPLY anterior, pero limita la evidencia de frescura tras la revisión visual.

### Cierre de release de correcciones PR 228 y arranque Fase 7 (2026-10-07)

PR 228 liberó las correcciones aprobadas a `master` como `3e6e3a45417e35d412dd8ece34dc90ecd7ccb8e0`. PRs 219–223 aportaron la funcionalidad; PR 220 sincronizó docs; PRs 225/226 fueron cambios de expectativas E2E únicamente. Producción y límites de verificación cloud se resumen en [`DEPLOYMENT.md`](DEPLOYMENT.md). Los resultados de tests se informan por ejecución y no se suman como si fueran un solo run.

#### CI y release

- CI del PR `37558507699`: quality (339 unit, 138 integration) y E2E (129 escenarios) pasaron, con un flaky reportado en `public-interest` sobre submit-disabled que pasó por retry automático.
- Una revalidación focal del caso `public-interest` pasó 1/1 con retries deshabilitados sobre `0e9c48d`, sin cambio de código ni causa raíz identificada; el pase focal no resuelve por sí solo el flaky anterior.
- CI del push a `master`, run `37559942423`: SUCCESS, 339 unit, 138 integration y full E2E 130/130 PASS; no se reportaron flakes en esa corrida. El resultado verde no identifica la causa del flaky anterior ni de la intermitencia local del guardado de grupo.
- Tras checks CI verdes, el usuario autorizó explícitamente omitir la aprobación administrativa requerida para el merge. No se omitieron checks CI ni se cambiaron las protecciones del repositorio.
- Vercel deployment `dpl_4VKVLtA5rP5YbP5y1Nymnc5TKMep` quedó `READY` para el SHA exacto de master y el alias `https://skillbase-alpha.vercel.app`. Smoke: rutas públicas y Auth respondieron 200; cuatro rutas privadas sin sesión redirigieron 303 a login.

#### Calidad local y límites E2E previos

- `lint`, `format:check`, Drizzle check y build PASS. Typecheck: 0 errores, 0 warnings y 214 hints; build 27.51 s sin warnings. Unit: 339 PASS (2046 assertions); integration: 138 PASS (983 assertions). Unit/integration se ejecutaron en `eacf6fe`; desde ese source no cambiaron aplicación, schema o dependencias.
- El full E2E local con `--retries=0` sobre `eacf6fe` pasó 99/130 y falló 31. El primer arranque, antes de escenarios, encontró ausente `@supabase/ssr/dist/module/index.js`; `bun install --frozen-lockfile --force` restauró el entorno y tres smoke focales pasaron antes del full run.
- PR 226 hizo que los fixtures de origen/CSRF usen el `SiteUrl` del servidor (puerto real `44891`) en vez de fijar `4321`; no cambió el rechazo CSRF del servidor. Su focused run fue 37/38, incluyendo 28/29 escenarios originales. PR 225 focused Google association fue 3/3; sus expectations de test no constituyen OAuth real.
- Los dos mismatches de expectativas E2E sobre visibilidad de perfil y ruta ADMIN protegida son cambios de tests, no evidencia de cambio del contrato de identidad. El submit «Guardar» de grupos falló deshabilitado en el full y focused local; un caso fresco pasó 1/1 con retries deshabilitados, sin cambio de código ni causa identificada. Mantenerlo como intermitencia sin causa raíz. La cobertura local parcial no se reporta como 130/130.

Los PR checks y el full master E2E cierran el gate de las correcciones para ese release; las corridas locales focales conservan sus límites. No se aplicó migración, reseed ni otra operación de datos para esta liberación. El ledger/conteos cloud no se verificaron de forma independiente en este release; ledger 20 es el último baseline conocido, no una comprobación nueva. La recepción de correo de prueba local no verifica recovery/cambio de contraseña ni entrega cloud; OAuth real y retención de 12 meses continúan pendientes.

#### Fase 7

PR 230 integró el backend base y PR 232 integró la UI en `development`. La UI tiene dos E2E focales PASS; quality reportado para la rama incluyó lint/format/diff, typecheck con cero errores y build PASS. Se revisaron screenshots de 390/768/1440 px en light/dark. Esto no equivale a un full E2E ni al gate combinado de Fase 7.

#### Backend Fase 7 — PR 230 (evidencia focal, no full gate)

- La migración 0020 genera cinco tablas y sus triggers/constraints. En la validación inicial de PR 230 se ejecutó solo en stacks Supabase de test aislados; la aplicación posterior al Supabase local canónico está registrada como una operación de operador abajo. No se aplicó a cloud.
- Backend focal reportado: cuatro unit tests y una suite de integración HTTP con 39 assertions PASS.
- Un comando accidental invocó `run-integration.ts` con `evaluation-repository.test.ts` como argumento, pero el runner ignoró ese argumento y ejecutó la carpeta completa: 118 PASS/24 FAIL. Veintitrés fallos provinieron de cleanup de fixtures que no incluía las nuevas tablas/FKs; otro caso dejó un residuo financiero de fixture. No se debe contar ese run como validación del full suite ni como defecto de la lógica de evaluación.
- El fix test-only `649441b` añadió las cinco tablas de evaluación al allowlist compartido de fixtures, dentro del mismo `TRUNCATE ... RESTRICT`. No modificó schema, FKs ni assertions de producto. La revalidación focal posterior pasó cinco casos en cinco archivos (88 assertions) y las cuatro unitarias; lint, typecheck, formatter y `git diff --check` PASS.
- En la validación inicial de PR 230 no se volvió a ejecutar la suite de integración después del fix; la continuación de QA en `fb27c89` sí pasó la suite completa 139/139 (ver abajo). Los resultados focales/esta cronología no equivalen a gate de Fase 7. No hay seed de evaluación; `FINANCIAL_DEMO.md` no constituye fixtures de notas.

El cleanup es infraestructura de tests aislados únicamente; no es un allowlist de reset/demo/producción. No hay seed de notas ni evaluación en el demo financiero.

Al stage de integración PR 230/232, backend/UI estaban en development sin gate Fase 7; ese snapshot se conserva como cronología. El cierre PR 235 y QA final están registrados abajo. Contrato y detalles de implementación en [`EVALUATIONS_CONTRACT.md`](EVALUATIONS_CONTRACT.md), [`DATA_MODEL.md`](DATA_MODEL.md) y [`PLAN.md`](PLAN.md).

### QA integrada Fase 7 — bloqueo inicial y continuación completada (source `c0506fc`)

#### Intento inicial (histórico, antes del fix de fixture PR 233)

La primera corrida terminó con exit code 1 a las `2026-10-07T03:59:24Z`; el estado idle se confirmó a las `04:03:23Z`, sin proceso E2E activo. Con un worker, `--retries=0` y `--max-failures=1`, Playwright seleccionó 132 casos: **25 PASS, 1 FAIL, 106 no ejecutados**.

El caso fue `tests/e2e/evaluations.spec.ts:107`. Falló durante `createAttendanceFlowFixture("2020-05-04")`, antes de interactuar con la UI, con `GroupError/SCHEDULE_CONFLICT`: un curso fixture archivado aún tenía grupos `PLANNED`, que seguían reservando el horario del instructor. La ruta llegó a `DrizzleGroupRepository.assertFree`. PR 233 identificó y corrigió el lifecycle del fixture, no el flujo UI ni las reglas globales de horario.

#### Continuación tras PR 233 — evidencia combinada PASS, no un full run único

- PR 233 modificó solo `tests/fixtures/attendance-flow.ts`: se rastrean cursos fixture archivados y sus grupos `PLANNED` reservan horario mientras no se cancelen; el cleanup cancela únicamente los grupos rastreados usando `DrizzleGroupRepository` y sus guards normales. No cambia la regla global de horarios, comportamiento de producto, schema ni dependencias, y no cancela grupos arbitrarios/globalmente.
- Las pruebas focales de attendance/evaluations pasaron 4/4 según la evidencia del owner; esta continuación no las repitió.
- `coverage-ledger.json` inventarió 132 identidades E2E. La corrida inicial aportó 25 casos PASS y los focales otros 4; dos se solapan, así que la cobertura acumulada antes de la continuación fue 27. La selección restante de 105 se ejecutó y pasó **105/105**, con un worker, port `44891`, retries 0 y `max-failures=1` en 7.0 minutos.
- En conjunto hay evidencia PASS para los **132 escenarios distintos**, pero **no** una única corrida full 132/132: el intento inicial se detuvo en el fixture fallido. Estado del continuation runner: `passed-combined-not-single-full`.
- Quality final: format y lint PASS; build PASS (Astro 17.00 s, comando 19.764 s). Se reutiliza la validación sin cambios de aplicación/schema/dependencias: unit 343 PASS/2080 assertions, integration 139 PASS/1022 assertions, typecheck 0 errores/0 warnings/229 hints, Drizzle PASS y `db:generate` sin cambios de schema. La continuación no volvió a correr unit/integration/typecheck.
- Esa continuación E2E y su cleanup corrieron en stacks temporales; en ese paso no hubo escrituras canonical/cloud ni aplicación persistente de 0020. Limpieza normal terminó, contenedores previos coincidieron, y el puerto E2E `44891` quedó libre. No inferir salud del root server `4321`.

Artefactos QA: `C:/Users/Steve/AppData/Local/Temp/opencode/phase7-final-validation-evidence/` (`CONTINUATION-RESULT.md`, `continuation-status.json`, `coverage-ledger.json`, `continuation-remaining-e2e.log` y el historial inicial en `RESULT.md`/`status.json`). No se realizó un single full 132/132 ni se afirma OAuth real, seed de notas o release de Fase 7.

La evidencia local combinada está completada con **132 escenarios cubiertos por corridas separadas**, no por una sola corrida 132/132. El full E2E local integrado no terminó verde de una vez; el conflicto de fixture se resolvió solo en tests y el conjunto restante pasó.

### Aplicación local de migration 0020 (operador, 2026-10-07)

Después de la QA integrada, el operador aplicó `bun run db:migrate` al Supabase local canónico `skillbase` en PostgreSQL `127.0.0.1:55322` (API `127.0.0.1:55321`): ledger **20→21**. El rerun quedó en 21 y la evidencia completa fue idéntica. Entrada 21: hash `ad01e4dea9f51c4d503eef524a458e9adffe4f90e37397c784b9ddffd25aa32b`, `created_at` `1791341690577`.

La comparación pre/post conservó **2802 filas en 59 tablas existentes**, incluidas filas completas/PK hashes, Auth, Storage, settings, audit payloads y receipts; también se conservaron los registros no poseídos y datos financieros/asistencia existentes: 12 cursos, 23 grupos, 16 registros, 13 movimientos, 282 sesiones (280 originales, 2 reemplazos), 3 cancelaciones, 16 marcas de participantes y 4 de instructor. Las cinco tablas F7 quedaron vacías; RLS habilitado, sin privilegios para `anon`/`authenticated`/`service_role`, y los seis trigger functions sin grants `EXECUTE` a esos roles. No hubo reset, reseed ni escrituras por API de aplicación. No se operó en cloud; no inferir ledger, conteos o tablas F7 aplicadas en producción. La aplicación no se inició ni actualizó en el worktree raíz, que permanece clean en `fb99108`; no se debe inferir ahí UI local de Fase 7. La evidencia fuente `c0506fc` está en `C:/Users/Steve/AppData/Local/Temp/opencode/phase7-local-migration-evidence/summary.json`.

Ese registro describe el estado inmediatamente después del APPLY local y antes del release PR 235; no era seed ni release del módulo. El CI/cloud posterior se registra abajo.

### Cierre de release Fase 7 (PR 235; master)

- CI del PR `37572831714`: full unit/integration y E2E **132/132 PASS**, sin flakes reportados. CI de `master` `37573738321`: SUCCESS con 343 unit (2080 assertions), 139 integration (1022 assertions) y full E2E **132/132 PASS**, sin flakes reportados.
- El run de master es una única suite full; no debe confundirse con la verificación local previa, que acreditó la cobertura de 132 identidades por unión de ejecuciones separadas (25 iniciales, cuatro focales con dos solapadas y 105 restantes).
- El fixture de PR 233 resolvió el `SCHEDULE_CONFLICT` de setup cambiando solo `tests/fixtures/attendance-flow.ts`: archiva/cancela los grupos rastreados con las APIs normales. No cambió el comportamiento de producto ni los guards de horario. La intermitencia histórica `public-interest`/submit-disabled y el guardado de grupo permanece sin causa raíz identificada; la corrida final sin flake reportado no prueba que la causa se haya eliminado.
- La migración 0020 se aplicó al Supabase local canónico y cloud mediante el flujo de release; la operación cloud se verificó después con consultas de solo lectura, descritas en [`DEPLOYMENT.md`](DEPLOYMENT.md). No se cargó seed de notas ni se hicieron escrituras manuales de datos.

Fase 7 queda liberada en `master` por PR 235. La migración/cloud y E2E de este release no equivalen a Fase 8 (cierre/planilla) ni Fase 9 (certificados), que siguen pendientes.

### Correcciones post-release de Fase 7 — verificaciones focales por entrega

Estado del árbol final local `fix/instructor-lifecycle-revision-selector` (`6b87d24d80df3810889139aa776604b0041b2802`, base `274db4cfdb7c927b3a69552eb8c0342fd363dbd2`): PRs 258–264 están en la línea local de trabajo; el commit final es un cambio de expectativas de test de lifecycle instructor. La fuente no está publicada ni mergeada. Esta sección registra evidencia focal comunicada por owners en worktrees distintos. **No representa una única corrida full local ni resultados acumulables como una sola suite.** No hubo escrituras a datos canónicos, Auth/cloud o migraciones.

| Bloque                                            | Evidencia focal                                                                                                                                                                                                                                                                                                                                                                            | Límite                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guardado atómico de notas (PR 258)                | 5 unitarias y 2 de integración; 63 assertions. El caso de uso/repositorio guarda toda la fila en una transacción; si una operación falla no queda una fila parcialmente actualizada. Los triggers existentes siguen ejecutándose por nota dentro de la transacción.                                                                                                                        | Sin migración. Prueba focal, no full integration.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Edición inline común (PR 260)                     | 63 unitarias PASS. Playwright CLI revisó 12 campos consumidores en desktop/mobile y fallback sin JS, con respuestas sintéticas interceptadas; loading conserva SVG/foco, y errors/retry conservan drafts/idempotencia.                                                                                                                                                                     | Sin escrituras reales; QA de consumidores aislados, no E2E de rutas/DB.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Interesados/preinscripción (PR 259)               | 55 unitarias (199 assertions). Integración dirigida inicial: 5 PASS y un fallo de fixture; fixture corregido y picker dirigido 1 PASS.                                                                                                                                                                                                                                                     | No se afirma una corrida única 6/6. La conversión excluye por vínculo histórico a la fila fuente, incluso preinscripción cancelada/reactivada; oculta de listas/métricas operativas y preserva interés de otros cursos. La UI ofrece solo interesadas del curso, busca CI/email/nombre con normalización Unicode de acentos/case/espacios, sin deduplicar por nombre/email. Alta manual mantiene búsqueda por CI y participante global. No se requiere extensión SQL `unaccent`. |
| Grupo/roster/calendario (PR 261)                  | 10 unitarias (63 assertions) y 49 verificaciones Playwright CLI segmentadas en un fixture de navegador/mock; 24 combinaciones responsive de 4 vistas, tres anchos y ambos temas. Typecheck 0 errores/0 warnings/245 hints y build PASS en esa fuente.                                                                                                                                      | QA visual/comportamiento sintético, no persistencia real ni suite E2E completa.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Esquema y notas (PR 262)                          | 5 unitarias; 2 E2E dirigidas PASS en stack aislado. Revisión manual Playwright con 40 PNG, seis componentes, guardado de fila atómico con JS y forms individuales sin JS.                                                                                                                                                                                                                  | No full unit/integration/E2E. El editor JS envía una petición por fila; el fallback HTML conserva POST individual por componente.                                                                                                                                                                                                                                                                                                                                                |
| Contexto de preinscripción/participantes (PR 263) | 87 unitarias y 1 E2E dirigida PASS, sobre stack temporal con POST real aislado. Se eliminó UI/routing duplicado de `/app/participantes`; las mutaciones de ficha se alojan en contexto de preinscripción. Se conserva identidad global por CI, historial financiero y referencias multi-curso; cancelación no disponible omite el control sin copy/modal y el deadline servidor no cambió. | No se atribuye gate completo. La ruta HTTP y navegación/skeleton se actualizaron; no queda un destino UI fantasma.                                                                                                                                                                                                                                                                                                                                                               |
| Perfil instructor (PR 264)                        | 22 unitarias (95 assertions); 161 comprobaciones manuales focales y seis mobile-save, con POST interceptado/sintético. Email de instructor se presenta como texto solo lectura, campos personales arriba de cursos asignados, Google en fila centrada.                                                                                                                                     | Sin persistencia/Auth lifecycle real ni E2E canónico.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Feedback/navegación (HEAD `d057d2d`)              | 4 unitarias (16 assertions), formatter, lint, typecheck 0 errores/0 warnings/245 hints y build PASS en ese head. QA manual Playwright en 37 checks segmentados, 16 combinaciones responsive/tema y creación de formato validada; 19 productores inspeccionados: diez corregidos, nueve preservados.                                                                                        | 37 checks no fueron una corrida limpia única; hubo segmentos/harness corregido. Se cambió una expectativa pendiente en `dual-auth.spec.ts`, sin ejecutar entonces esa especificación. Ver la validación final del selector E2E en el head más reciente abajo.                                                                                                                                                                                                                    |

Los resultados anteriores son evidencia focal por PR/stage y no se suman como una única suite. El cierre local combinado del head final está registrado debajo; el CI remoto y la publicación no están acreditados.

### Validación local combinada final de correcciones (source `6b87d24`; publicación bloqueada)

- El source exacto es `6b87d24d80df3810889139aa776604b0041b2802`, base `274db4cfdb7c927b3a69552eb8c0342fd363dbd2`; rama local `fix/instructor-lifecycle-revision-selector`. Remote `development` sigue en `274db4c`. No está publicado/mergeado, y no se afirma CI remoto. La diferencia fuente vs. head previo modifica solo `tests/e2e/instructor-lifecycle.spec.ts`; aplicación/schema/dependencias no cambiaron.
- **E2E:** corrida final de 77 casos previamente no cubiertos: 77 PASS, 0 FAIL, 0 NOT RUN, retries 0, 322.491 s (5.4 min). El ledger registra 132 identidades distintas PASS combinando los casos anteriores/focales y esta corrida; no fue una sola corrida full local 132/132. Los fallos/selecciones intermedias se conservaron, no se presentaron como passes.
- **Unit:** cobertura combinada 357 PASS / 1 FAIL inicial por expectativa de ruta Auth retirada, más una focal Auth corregida 11/11 (10 solapados); suma de casos distintos cubiertos: 358. No se afirma un único full unit verde 358/358. Assertions no se suman.
- **Integration:** 142 PASS / 1077 assertions desde `82a75f3`; se reutiliza porque la fuente de aplicación/schema no cambió posteriormente. No se vuelve a atribuir como una corrida sobre el nuevo commit de tests.
- **Quality:** formatter, lint, typecheck (0 errores/0 warnings/245 hints), checks Drizzle y `db:generate` sin cambios de schema PASS. El primer build del milestone sobre el head final pasó en 25.314 s.
- La selección correcta del E2E restante se verificó con ledger y `playwright --list` antes de ejecutar. Ejecución con retries deshabilitados y el runner aislado ya existente. El login/permisos, stale revisions, fallos 409/422, persistencia de valores/foco y accesibilidad se verificaron con las expectativas de campo/intención afectada, no con assertions globales débiles. Los errores iniciales de fixtures/rutas y sus resultados parciales permanecen en los artefactos históricos.
- Los cambios de expectativa fueron focales y alineados con contratos/controles actuales, sin editar código de aplicación: ruta Auth ya retirada; nombres accesibles de guardar/cancelar en asistencia; visibilidad de cursos activos y cierre del toast de 600 ms; estados ADMIN/SSR de dual-auth y los casos Google afectados; publicación de curso con error inline sin toast duplicado; draft de grupo retenido tras 422 y recuperación campo-a-campo para 409 de horario; revisión de lifecycle del instructor acotada al formulario de desactivación. Las assertions siguen exigiendo error visible, valores/foco y ausencia de escritura inválida. No se eliminó cobertura de producto.
- Intentos intermedios con fixtures/base incorrectos, dependencias faltantes o selección E2E mal acotada quedaron preservados como cronología; la selección exacta se corrigió y verificó por `--list` **antes** de contar y ejecutar los 77 casos finales. No se cuentan esos errores de harness/base como defectos de aplicación ni como pases.
- Evidencia reproducible, status/coverage ledger, reporters y build están en `C:/Users/Steve/AppData/Local/Temp/opencode/interface-corrections-final-validation-evidence/` (`REMAINDER8-RESULT.md`, `remainder8-coverage-ledger.json`, `remainder8-e2e-list.json`, `remainder8-execution-status.json`, `remainder8-build.log`).
- **Límites de release:** el push y la publicación GitData REST fallaron con HTTP 500; el publicador se detuvo. No se afirma que GitHub se recuperara ni que PR/CI existan o pasaran. No hubo escrituras cloud/canónicas, migraciones, deploys ni actualización de producción. `master` continúa en Fase 7 `4afa485`, cloud ledger 21. La intermitencia histórica de `public-interest` y guardado de grupo sigue sin causa general identificada; este resultado no la resuelve. No inicia Fase 8.

## Release de correcciones Fase 7 — PR 278

PR 278 liberó las correcciones post-release a `master` como `91beccf8`. CI master run `37670004492` pasó en el primer intento limpio: **358 unit/2160 assertions**, **142 integration/1077 assertions**, **134/134 E2E**, sin retries ni flakes reportados. Formatter, lint, typecheck (0 errores/0 warnings/245 hints), build, migraciones y deploy también PASS. Vercel `dpl_CM7pwMYLxoqYBzP96KAeqQb8dxP7` está `READY` para el SHA de master.

Smoke post-release: rutas públicas/Auth respondieron 200 y cuatro rutas privadas de evaluaciones sin sesión redirigieron 303 a login. No hubo signin productivo, envío de correo, mutación pública/interesados, seed ni escritura de datos. No afirmar Google OAuth real, recuperación SMTP completa o delivery cloud. Supabase cloud se consultó en modo read-only: ledger 21, timestamp `1791341690577`, hash `ad01e4dea9f51c4d503eef524a458e9adffe4f90e37397c784b9ddffd25aa32b`; 11 cursos, 22 grupos, 15 preinscripciones, 12 movimientos, 282 sesiones, 16 marcas de participantes y 5 de instructor, 5 usuarios Auth, 10 sesiones, 1 ADMIN, 4 instructores, 2 objetos Storage y una fila por tabla settings; tablas F7 vacías. No se tomaron hashes pre/post de todas las filas ni se afirma preservación cloud integral. No hubo cambio de schema ni migración nueva.

Cronología de expectativas/intermitencias: PR 275 (`4cbe510`) registró 133 PASS y un flaky de selector de formatos (toast activo vs. toast en salida); PR 277 corrigió el selector de test y PR 278 pasó sin flakes/retries reportados. PR 275 también tuvo el fallo de readiness de `public-interest`. PR 276 corrigió readiness DOM/hidratación; la validación posterior pasó nueve ejecuciones de suite y seis repeticiones focales, pero no hay trace para demostrar que ese mecanismo explicara exactamente el interleaving CI. La intermitencia histórica de guardado de grupo sigue sin causa raíz general; el CI limpio no acredita que todos los flakies históricos estén resueltos.

## Shards E2E aislados — PR 279 integrado en development

El usuario aprobó dos shards Playwright concurrentes, cada uno en runner GitHub separado y con proyecto Supabase/Auth/DB y servidor Astro independientes. PR 279 integró esta infraestructura a `development`; el run final exitoso se registra abajo. Integration corre una vez y `integration-e2e` exige éxito de `quality`, integration y ambos shards. `deploy` conserva master-only, depende de `quality` + agregador y el shard chore no se promueve por separado a `master`.

- La ejecución propuesta usa shards `1/2` y `2/2`, puertos Astro 44891/44892 y mantiene `workers: 1`, `fullyParallel: false` y la política existente de retry. No se multiplexan browsers contra la misma DB.
- Inventario exacto local: 134 casos (126 Chromium + 8 Chromium mobile). Shard 1: 69 Chromium; shard 2: 57 Chromium + 8 mobile. Paridad comprobada por identidad de proyecto/archivo/título/línea: unión 134, solapamiento/faltantes/extras cero. El agregador always-run falla cerrado ante test/job fallido, omitido, cancelado, timeout o interrupción; solo el par `success/success` pasa. Los 16 pares posibles de estado fueron probados. Cada shard adjunta `e2e-shard-1` o `e2e-shard-2` con evidencia, blob report y `test-results`.
- Validación focal local del candidato: 13 unit PASS/21 assertions, formatter/lint/typecheck/build/diff PASS, inventario/paridad y smoke Foundation desktop/mobile 2/2 con retries 0. Ese smoke por sí solo **no** representa 134 E2E; el full 134/134 se verificó después en CI remoto PR 279 (abajo).
- No se hizo benchmark local de shards por límite de memoria: 4.12 GiB libres de 15.19 GiB, Docker con 7.36 GiB, además de stacks ajenos/preexistentes. No arrancar stacks adicionales ni detenerlos; el smoke no tocó el listener root 4321 ni el stack canónico.
- Baseline remoto master `37670004492`: `integration-e2e` 12m10s; Chromium install 2m15s; integration 2m03s; E2E 7m40s; quality 59s. Antes de merge/activación, el PR de CI debe demostrar outcomes y paridad para los 134 casos en ambos runners concurrentes y medir duración total comparable —incluidos stack, migraciones, fixtures/inventario, servidor, tests y cleanup—. No afirmar aceleración hasta tener esa medición en el mismo entorno.
- Artifact/inventario original reportado en `C:/Users/Steve/AppData/Local/Temp/opencode/e2e-sharding-evidence/handoff.md`; PR 279 integró la infraestructura a `development`. No se promovió por separado a `master` ni se cambiaron secrets/schema.

### Primera validación remota del candidato y revisión del gate requerido

- El primer run de PR 279 (`37675836980`) validó la revisión `4ecf1e`: 371 unit/2181 assertions, 142 integration/1077 assertions y ambos runners E2E independientes. Los shards cubrieron sus cohortes `69 + 65 = 134`, y todos los casos fueron PASS en el primer intento, sin skips, flakes ni retries. Ubuntu ejecutó cada job con su propio proyecto Supabase/Auth/DB y servidor/puerto. Artifact de cohorte citado por el owner: `1150604945611507347422`; el resumen quedó en el comentario de PR `6045563750` y los artifacts tienen retención de 7 días.
- Después de ese run, el source owner endureció el DAG y añadió remediation de APT; las pruebas focales de gate/provisioning suman 18 tests/106 assertions. El intento intermedio `37678477638` pasó quality (375 unit/2257) e integration (142), pero falló en provisioning del segundo shard. El run final post-remediation `37684331005` pasó y se detalla abajo.
- Benchmark de **una sola observación** entre CI baseline run `37670004492` y candidato run `37675836980`: envelope E2E 460 s vs. 387 s (-15.87 %); critical path requerido sin espera inicial 730 s vs. 426 s (-41.64 %); tiempo agregado no-deploy 789 s baseline vs. 931 s candidato (+18 % runner consumption). Shards de 343.884/267.106 s de comando, jobs de 416/297 s, integration 132 s, quality 78 s, agregador 8 s y envelope candidato ~430 s. Hosts/redes/referencias difieren; workflow de deploy del baseline no es comparable. No afirmar mejora robusta ni 2× por esta única observación.
- La validación local comprobó inventario y smoke, pero no ejecutó los shards simultáneamente por los límites de memoria ya descritos. El run final de PR 279, abajo, ejecutó la matriz completa en GitHub.
- El workflow agrega checks para PRs a `development`, pero las reglas de branch protection no los exigen de forma efectiva (situación preexistente). El operador verificó todos los checks requeridos antes de integrar PR 279. Las reglas/gates de `master`, permisos, secrets y deploy permanecen intactos.

### Intento intermedio bloqueado por provisioning APT (run `37678477638`; histórico)

- El run intermedio `37678477638` se canceló tras **1870 s** (gate 1866 s; jobs agregados 3013 s). `quality` pasó 375 unit/2257 assertions; integration 142/142 / 1077; shard 1 pasó 69 tests y shard 2 no ejecutó tests, detenido antes de Chromium durante APT. El agregador falló y deploy se omitió. Este intento fue incompleto y quedó supersedido por el CI final de PR 279.
- En logs del shard 2, `bunx playwright install --with-deps chromium` entró a instalar APT deps y `apt` siguió consultando `azure.archive.ubuntu.com` por HTTP desde `apt-mirrors.txt`; no se observó progreso de acquisition durante ~30 min. El shard 1 descargó 32.5 MB APT desde Azure en 9m01s (~59.9 kB/s) antes de iniciar la descarga del Chromium CDN. El InRelease HTTPS de `archive.ubuntu.com` respondió, pero Packages/Translation continuaron por la fuente Azure HTTP. Esto identifica una demora de provisioning APT/mirror, no un fallo de descarga del browser ni aserción de tests. Logs no determinan una causa DNS/socket específica y no muestran apt lock: no atribuir una causa de transporte más concreta.
- Remediation integrada por PR 279: fijar solo jobs E2E a `ubuntu-24.04`; validar el sources list, retirar Azure HTTP y mantener fuentes oficiales HTTPS; timeout APT de conexión/datos 30 s, retries 0 y error ante índices incompletos; paso de configuración de mirrors máximo 1 min y `bunx playwright install --with-deps chromium` máximo 5 min. Job total conserva 30 min. Sin `continue-on-error`, dependencias omitidas, retries extra o caché de paquetes sistema. Playwright/Chromium, lockfile, workers, stacks/puertos, secrets, permisos y deploy no cambiaron.
- Evidencia local de remediation: 18 tests focales/106 assertions; formatter/lint/diff PASS; typecheck 0/0/245. Dry-run y launch de Chromium disponible `153.0.8010.12` en Windows, y HEAD HTTPS local a InRelease oficiales 200. No probaba APT Linux; el run final abajo sí ejecutó provisioning en ambos Ubuntu runners.
- Evidencia/handoff histórico: `C:/Users/Steve/AppData/Local/Temp/opencode/e2e-sharding-evidence/browser-provisioning-remediation-handoff.md`.

### CI final post-remediation PR 279 — PASS

Run `37684331005` pasó **376 unit/2266 assertions**, **142 integration/1077 assertions** y **134/134 E2E** en dos stacks independientes (69+65). Ambos runners completaron APT/Chromium; todos los tests fueron first-pass sin flakies, retries o skips reportados. Quality, integration y el agregador estricto de statuses pasaron. PR 279 se integró a `development`; el operador comprobó manualmente los estados requeridos, porque development carece de branch protection efectiva. No se promovió el chore a master ni se alteraron master/deploy.

El run valida la remediación en esa ejecución, pero no identifica causalidad DNS/socket del stall previo ni garantiza disponibilidad futura de los mirrors.

## Fase 8: QA por PRs y release final

Las métricas y ledger de las subsecciones siguientes documentan QA/CI por etapas previas a PR 286; el estado post-release está resumido en la subsección final.

- En las etapas QA pre-release, migration candidata 0021 se aplicó a stacks aislados (ledger temporal 21→22). Luego PRs 280–285 integraron core, exports, UI/policy de cierre y lifecycle/admin UI. El owner reportó verificación live focal de los seis GET/download paths en QA. El release final posterior se documenta abajo.
- QA focal por etapas de cierre, sin sumar como full suite: core 21 unit/123 assertions + 19 integration/238; guards F5 54 unit/189 + 22 integration/168; privacy projection 1 unit/92 + 2 integration/81. Instructor projection es allowlist recursiva sin CI/contacto/categoría/finanzas; snapshot no se muta.
- UI de cierre reportó 21 unit/137 assertions, 3 E2E first-pass y revisión manual de 12 screenshots en 390/768/1440 light/dark. Los E2E cubren flujo SSR, ownership/roles, histórico y fallback no-JS; no verifican descargas.
- Export adapter focal: 12 unit/169 assertions y 1 integration/30; estas pruebas unit/integration ejercitan helper/adapter. Después, PR 284 añadió 3 E2E focales de descarga; el owner también verificó los seis GET/download paths live por CLI en QA. Run PR 284 `37718702107`: 400 unit, 160 integration y 137 E2E, first-pass reportado. Run PR 282 `37704840097`: 393 unit/2490 assertions, 150 integration/1246 assertions y 137 E2E (72+65), sin retries/flakies/skips. Son gates de PR individuales, no el gate final F8.
- En QA backend pre-release, 0022 se probó en stack aislado (ledger 22→23). El release PR 286 aplicó 0021/0022 a canónico local y cloud por el pipeline normal; ver el resultado final abajo.
- Handoff del core closure en `C:/Users/Steve/AppData/Local/Temp/opencode/academic-closure-integration-final.log`, `academic-closure-entry-integration.log`, `academic-closure-typecheck-final.log`, `academic-closure-build-final.log` y `academic-closure-format-final.log`. La nota de no escritura en esos logs no implica que todos los stacks QA de etapas posteriores hayan quedado intactos.

### UI de cuentas ADMIN (PR 285, integrada y liberada por PR 286)

- Incluye 32 unit tests y dos E2E dedicados, ambos first-pass sin retries. Las E2E verifican desde sesión ADMIN la creación de cuenta, ausencia del password en HTML, edición independiente de nombre, readonly de correo, búsqueda/teclado desde tarjeta mobile y eliminación no usada; el otro flujo valida login con contraseña creada, auto-desactivación de cuenta con uso, invalidación de sesión y reactivación por otro ADMIN sin resetear credenciales.
- Route-policy tests cubren list/create/detalle UUID como ADMIN-only, rechazo de rutas estructuralmente inválidas/wildcards y paridad con rutas privadas de cierre. Helpers SSR verifican fallback HTML, error 422 renderizado con draft nombre, actualización del nombre tras respuesta y manejo de actor que pierde sesión. La navegación y las tres páginas ADMIN quedaron integradas por PR 285.
- Calidad reportada para el feature: lint, formatter, typecheck y build PASS. La revisión visual final fue hecha en la app sobre QA aislado con 20 PNG, incluyendo grid/lista responsive, long text, focus/dialog, empty/success/error y status UX. Algunos intentos focales anteriores tuvieron expectativas/locators fallidos y no se cuentan como passing suite; el resultado documentado se limita a las dos pruebas E2E que pasaron first-pass y verificaciones independientes reportadas.
- Un intento QA anterior eligió incorrectamente un stack paralelo por heurística de “más reciente” y creó fixtures sintéticos allí; el owner retiró identidades Auth sintéticas y eliminó el stack. Los tests finales usaron el stack explícito propio del runner; el stack temporal fue eliminado al terminar. No se tocó el Supabase local raíz/canónico, cloud ni producción. Para futuras ejecuciones: fijar project ID/puertos, no inspeccionar “stack más reciente”, no hacer cleanup Docker global y limitar limpieza a fixtures propiedad del run.
- Backend ADMIN PR 283 pasó CI run `37717389828`: 400 unit/2530 assertions, 160 integration/1314 assertions y 137 E2E en dos shards (72+65), first-pass sin flakies/skips/retries reportados. Antes hubo una corrida PR previa con fallo de expectativa del nombre HTML 422 y retries; el test se corrigió para verificar la respuesta HTML y actualización del nombre. La integración QA aplicó 0022 (ledger 22→23) en stack aislado.
- CI PR 285 run `37718988907`: 412 unit/2608 assertions, 160 integration/1314 assertions y 139 E2E en dos shards (74+65), first-pass sin fallos, skips, flakes ni retries reportados. El gate integrado y su conteo definitivo están en el release PR 286 abajo.
- Las rutas de cuentas ADMIN quedaron en development por PR 285. El release a master y la preservación de datos constan en la siguiente subsección; no se ejecutó un smoke autenticado ni se crearon cuentas ADMIN reales.

### Release Fase 8 — PR 286

- PR 286 liberó `68c918119f2ec094ba7cc63b217efd2448480505`. CI run `37727200394`, attempt 1, tuvo todos los jobs requeridos SUCCESS: 412 unit/2608 assertions, 160 integration/1314 assertions y 139 E2E únicos (131 Chromium desktop + 8 Chromium mobile), 139 first-pass, cero retries/flakes/skips. Typecheck 0 errores/0 warnings/306 hints; quality, migraciones y deploy PASS. La aprobación administrativa se omitió solo tras verificar los checks verdes; no se modificaron las protecciones del repositorio.
- La Vercel deployment `dpl_5z8QnQiF7H1naY4X33ZNe74sspzt` quedó `READY` para el SHA exacto de master, alias `https://skillbase-alpha.vercel.app`. Smoke postdeploy efectuó 36 requests anónimas; privadas redirigieron a login. No se efectuó smoke autenticado en producción.
- Pipeline release aplicó 0021/0022 normalmente a canónico local y cloud, ledger 21→23. Las nuevas tablas académicas y `admin_account_deletions` estaban vacías al verificar; RLS/grants, funciones protegidas y nueve triggers de guarda/inmutabilidad se confirmaron.
- Comparación completa local pre/post confirmó igualdad de las 2,843 filas en 64 tablas, incluyendo replay de migración y smoke. Comparación server-side cloud de keys y hashes de filas completas confirmó 876 filas/66 tablas idénticas y prefix del ledger 21 intacto; solo se añadieron las dos entradas del ledger autorizadas. Se preservaron Auth identities/roles, auditoría, finanzas, sesiones, Storage, settings y demás historial existente. No se crearon cuentas ADMIN reales, cierres/snapshots académicos, notas ni seeds.
- Evidencia técnica/hashes y metadata se conservaron en `C:/Users/Steve/AppData/Local/Temp/opencode/phase8-production-release-evidence/`; el snapshot protegido incluye resultados de comparación y no incorpora PII en esta documentación. El smoke fue anónimo, por lo que no se afirma Google OAuth real, recovery/SMTP cloud ni una operación autenticada ADMIN en producción.
- Fase 8 quedó liberada dentro del alcance aprobado. En ese límite de release Fase 9 aún no estaba iniciada; su estado posterior se registra abajo.

## Correcciones UI y demo integral — snapshot histórico PRs 289/288 en development

Las correcciones UI del contrato [`UI_CORRECTIONS_CONTRACT.md`](UI_CORRECTIONS_CONTRACT.md) se integraron mediante PR 289; el runner sintético integral F1–F8 se integró mediante PR 288. El head candidato de `development` es `53f171e10c6b5ac922d9f4c5760f788b9f7bdebe`. El release a `master`, deploy y carga productiva de demos aún no se han ejecutado. No hubo migración ni cambio de schema en estas entregas.

El CI integrado final del PR 288, run `37818957648`, pasó al primer intento: **424 unit tests / 2,866 assertions**, **162 integration tests / 1,332 assertions**, más el test focal del demo integral **1/1 / 890 assertions** en un stack Supabase temporal separado, y **140/140 E2E únicos** (132 desktop + 8 mobile). Los dos pasos de integración usaron stacks aislados propios en el mismo job; ambos fueron obligatorios y la limpieza del stack del demo también debía pasar. Quality, formatter, lint, build y typecheck pasaron (0 errores/0 warnings/312 hints); integration/E2E pasaron sin retries, flakes ni skips reportados. El deploy del PR se omitió según el workflow; esto no equivale a CI/deploy del siguiente push a `master`.

### Cronología de correcciones de pruebas (se conserva; no se cuentan intentos rojos como verdes)

- Un intento anterior en el source UI falló E2E con selectores de confirmación desactualizados; las assertions se acotaron al control correcto y los casos funcionales pasaron 3/3 first-pass, sin modificar la confirmación del producto. El CI intermedio `37813497360` registró 137 PASS y 3 FAIL, con retries automáticos; fue supersedido por el gate final `37817578467` (419 unit/2,645 assertions, 162 integration/1,332 assertions y 140 E2E; typecheck 0/0/308 hints), que pasó first-pass sin fallos, flakes, retries ni skips reportados.
- En QA del seed hubo un conflicto real de fixture de horario reservado por un grupo de instructor; el cleanup se limitó a grupos fixture propios mediante repositorios/guards existentes, liberando el slot sin tocar reservas ajenas. Un caso focal de esa preparación pasó 1/1 con 11 assertions y dos E2E repetidos pasaron sin retries. Un fixture de accesibilidad también falló por falta de label de hora en un source previo; el caso sobre el source ya corregido pasó 1/1 first-pass.
- Una corrida de integración anterior terminó 160 PASS / 2 FAIL por un precondition global de ADMIN en el test y un timeout de 5 s para el test nuevo de consulta, no por fallos de endpoints de producto. El test se aisló preparando otros ADMIN activos y se amplió solo su timeout acotado por la carga de setup. Una verificación posterior de setup no pasó por indisponibilidad temporal del lookup de estado de Supabase; no se presenta como pase. El run final integrado de arriba es la evidencia verde completa.
- El full unit previo pasó 415 casos/2,810 assertions; esos resultados por etapa no se suman de nuevo al run integrado.

El test del runner ejecutó PLAN/APPLY/repetición sobre un Supabase temporal propio. Verificó preservación de **416 filas en 70 tablas** existentes y que la repetición idempotente agregara cero cambios. La carga de prueba dejó 8 cursos, 10 grupos, 26 preinscripciones y 25 participantes sintéticos, además de 4 instructores, 5 ADMIN, 3 versiones de cierre, una reapertura y una baja ADMIN completada mediante el lifecycle. Estos datos pertenecen al stack temporal del test y no al Supabase canónico/cloud.

No se afirma una revisión visual manual con Playwright CLI/screenshot para este cierre. La validación reportada aquí es automatizada y contra comportamiento/persistencia; tampoco constituye smoke autenticado en producción. No se ha ejecutado PLAN/APPLY del runner en local canónico ni en producción; la próxima operación productiva requiere un checkout limpio del SHA exacto ya liberado y guards/approval descritos en [`DEMO_SEED.md`](DEMO_SEED.md). La interfaz Fase 9 se implementó después y tiene su evidencia separada abajo.

## Interfaz de certificados — validación focal en la rama

El commit local `a450987` conecta las páginas de certificados con el ciclo backend/PDF de los commits base. El source UI permanece en `feat/certificate-interface`, sin push/PR ni integración en `development`. Esta evidencia no es CI remoto, validación del full suite, ni release/deployment. El CI de development citado abajo corresponde a CORE y no incluye esta UI.

- Calidad del source de interfaz: lint, format check, Astro typecheck (0 errores/0 warnings; 351 hints), build y `git diff --check` PASS.
- Unit focal: 8 tests PASS / 40 assertions. E2E focal: 2/2 PASS, cero retries, sobre un proyecto Supabase temporal dedicado. El E2E cubrió generación/carga/revisión/emisión/revocación/reemplazo, descargas privadas, privacidad pública, comparación de hash, carreras de lectura/archivo y fallback sin JavaScript. No se volvió a ejecutar el full unit/integration/E2E de la suite del proyecto.
- QA manual posterior con Playwright CLI ejercitó rutas reales sobre otro stack aislado: PDF inválido rechazado con 422 y valores conservados; upload válido 200; review 200 con aceptación explícita; emisión 200; instructor readonly y descarga privada 200; verificación pública sin enlaces PDF ni requests públicos de archivo. Se revisaron desktop/tablet/mobile (1440/768/390), light/dark y teclado. La secuencia manual no sustituye un E2E automatizado adicional después del pequeño refinamiento del picker/metadata.
- Los archivos PDF usados eran fixtures sintéticos. Esta ejecución prueba manejo técnico y no valida firmas manuscritas, legitimidad institucional ni identidad del portador. El cálculo SHA-256 del archivo elegido se hace localmente en el navegador; no se transmiten sus bytes para esa función.
- La aplicación no tocó migraciones ni datos del Supabase canónico/cloud. Los stacks temporales de QA fueron limpiados. No se realizó CI remoto ni smoke autenticado de producción; la interfaz no está acreditada como desplegada.

No se afirma una revisión visual manual con Playwright CLI/screenshot para el cierre del seed. El snapshot de esa sección es previo al release; la evidencia posterior está abajo.

### Release PR 292 y operación protegida F1–F8 (estado actual)

- PR 292 liberó el workflow protegido `production-comprehensive-demo.yml` a
  `master` `2789d55e93a97cc5344930e690e9feecc2cc10f5`; `development` es
  `a276e30fab3526cc086fc3efbe03a42d08681ba9`. Vercel `dpl4CZ` quedó READY para
  el SHA de master. El workflow seed se ejecutó manualmente aparte del deploy.
- El gate master `37846141904` pasó en attempt 1: 429 unit/2,945 assertions,
  162 integration/1,332 assertions, 1/894 assertions del caso comprehensive-demo
  y 140/140 E2E (132 desktop + 8 mobile). No hubo fallos, retries, flakes ni
  skips reportados en ese run; TypeScript 0 errores/0 warnings/313 hints.
- La cronología conserva una flake anterior (run `378382`, un caso; causa raíz
  desconocida). PR 293/run `37843958082` añadió diagnóstico/trace del primer
  fallo; no es evidencia de un fix de aplicación. PR 292/run `37845044909` y el
  gate de master final se reportan separadamente, no se suman entre sí.
- PLAN `37854318652` y APPLY `37854790028` en cloud preservaron 72 tablas/899
  filas originales por hashes server-side de fila completa+PK; ledger 23,
  settings N=3 y mínimo de pago 25 quedaron intactos. El replay no produjo
  cambios. Los conteos añadidos, 7 GETs públicos y resultados están en
  [`DEMO_SEED.md`](DEMO_SEED.md). La carga F1–F8 no creó certificados ni
  migraciones F9.
- La carga local canónica previa usó un baseline separado de 70 tablas/2,906
  filas originales y también preservó hashes/replay cero; no comparar tamaños de
  baseline entre entornos. En este boundary Fase 9 estaba aún en ramas de
  feature y no se contaba como implementada ni cubierta por esos gates; la
  integración/gate combinado posterior está documentado en la sección actual al
  final de este archivo.

### Pulido local de filtros y scroll del calendario (fuente `bf938d3`)

La rama `fix/calendar-filter-scroll` añade cobertura unitaria para la selección/deselección de filtros de estado, combinación con fechas y límite civil de Bolivia: **23 unit tests / 120 assertions PASS** en los tres archivos unitarios de asistencia. La cobertura E2E se ejecutó de forma aislada con retries deshabilitados: los dos casos existentes de asistencia/autorización pasaron juntos en una ejecución; el nuevo caso del calendario pasó en una ejecución posterior. Los resultados acreditan los tres escenarios por corridas separadas, **no** un E2E único 3/3 ni el full E2E.

La revisión manual Playwright CLI verificó el calendario con doce sesiones en 320, 768 y 1280 px, toggle por teclado, selección de fecha y «Todas», scroll por rueda/touch/teclado, ausencia de overflow horizontal y un solo scroll vertical principal. También se inspeccionaron claro/oscuro, paletas públicas y `forced-colors`. Fue una verificación manual segmentada, no una corrida E2E adicional ni una revisión full del producto.

Lint, format check, typecheck (0 errores/0 warnings/313 hints existentes), build de producción y `git diff --check` pasaron en el árbol final. La cronología E2E conserva un primer intento 0/3 por errores de hidratación tras builds/servidor concurrentes; la recuperación secuencial pasó 2/3 casos existentes, pero inicialmente falló la assertion geométrica de PageDown; otra ejecución focal pasó 2/3 y falló al dejar el foco en un enlace fuera de pantalla; el E2E nuevo también tuvo una ejecución focal 0/1 antes del pase final 1/1. Los resultados corregidos no borran esos intentos ni los cuentan como pases. Evidencia y ledger de intentos: `C:/Users/Steve/AppData/Local/Temp/opencode/calendar-scroll-evidence/attempt-ledger.md`.

La fixture E2E usó únicamente el stack Supabase temporal aislado; no hubo escrituras en producción ni cambios de DB/schema/migraciones. Estos resultados pertenecen a la fuente local indicada y no acreditan CI remoto, integración, full gate, release ni despliegue.

### PR 296 — CI actual y estado

PR 296 se integró a `development` mediante merge
`47def8735aba233d1802eb51b4c4acaab66e1a39`. CI `37951088066` pasó en el primer
intento: 431 unit/2,985 assertions, 162 integration/1,332 assertions, demo focal
1/894 y 141 E2E únicos (75 + 66), sin fallos, retries, flakes ni skips reportados
en esa corrida. Esto no acredita release a `master` ni despliegue del calendario.

La cronología conserva el run `3789921`, con una falla histórica de `PageDown`
en viewport mobile 320 px donde no se observó movimiento vertical. No se conoce
la causa raíz. La revisión manual posterior comprobó que `PageDown` mueve el
contenido en 320/768/1280 px, pero no se afirma que esto demuestre o corrija la
causa del fallo anterior; tampoco hay aserción CSS/geométrica que lo oculte. El
diagnóstico read-only sigue separado del resultado verde del CI actual.

## Búsqueda de instructor y resultados académicos compactos (PR 295)

PR 295 se integró en `development` mediante merge
`3323536deed04d18a1fa5fa547b23d3791349a94` (source `ae5999a`); esta evidencia no
acredita release a `master`.

La rama `fix/live-instructor-search-and-compact-results`, HEAD
`6c5bba7bc3b5a06eb476e209d2827b2dd666f6b4` sobre base `a276e30`, modifica solo
UI y pruebas de nueve archivos. No modifica API/DTO, permisos, reglas académicas,
snapshot, esquema ni datos canónicos/cloud.

- Tests unitarios focales: **5/5 PASS, 43 assertions** (presentación de
  evaluaciones/cierre). Quality local reportado PASS.
- E2E focal inicial en app aislada `4493`: **8/8 PASS**, cero retries. Durante
  otra ejecución concurrente con un build, tres escenarios pasaron y cinco
  fallaron con errores de carga de islas (`_jsxDEV`/import Vite), incluidos
  módulos sin cambios. No se modificó el producto ni se ocultó esa ejecución.
  La revalidación serial recuperó el shell original ya terminado: **8/8 PASS**,
  exit 0, un intento por caso y sin retries; no se lanzó una corrida duplicada.
  Esto valida el conjunto focal, no es un full E2E/release gate ni prueba la
  causa raíz del episodio concurrente.
- CI PR 295, run `37895589666`: **429 unit / 2,964 assertions**, **162
  integration / 1,332 assertions**, test focal de seed **1/1 / 894 assertions**
  y **140/140 E2E únicos** en dos shards (75 + 65). El run terminó en el primer
  intento; no se reportaron fallos, flakes, retries ni skips. Es evidencia CI
  para PR 295, no un full gate de Fase 9 ni un release/deploy.
- Playwright CLI manual comprobó rutas HTTP reales y DTOs de rol autorizados,
  incluyendo cierre oficial de un grupo con 3 componentes, resultados de 9
  componentes, detalle, pendiente/cero, instructor con asignación y SSR sin JS.
  Viewports: 320, 768 y 1280 px; sin overflow horizontal medido. La tarjeta usa
  diálogo al hidratar y disclosure funcional sin JS. Valores de nota/componentes
  alineados en desktop/edit/readonly; el modo instructor no expone CI, saldo,
  categoría, correo ni teléfono. La verificación no usó mocks de respuesta,
  renderer inyectado ni DB productiva.
- Search E2E comprueba filtrado inmediato por nombre/correo, normalización
  Unicode (acentos/case/espacios), foco estable, limpiar/restaurar, history/back,
  sin Enter obligatorio para filtrar ni solicitudes adicionales por búsqueda;
  el submit GET conserva fallback sin JavaScript.
- El stack propio quedó limpio después de la revalidación y smoke CLI: cero
  containers/listeners en los puertos de app 4493/4495. No se detuvieron servicios
  compartidos ni se tocaron datos/Auth de canónico, cloud o producción.

Esta validación de PR 295 no representa gate completo de Fase 9 ni verifica otros
cambios en curso.

### Gate CORE tras PR 294 (boundary histórico; supersedido por gate F9 combinado)

Inmediatamente tras el merge CORE PR 294 (`de22705230b07538dfe4584e678fd35deb3d1ca2`), CI `37955046219` pasó en el primer intento: quality sin errores/warnings, **451 unit / 3,882 assertions**, **177 integration / 1,452 assertions**, test del seed **1/897 assertions** y **142 E2E** en dos shards (75 + 67). La verificación de preservación registró 75 tablas y 418 filas originales sin cambios tras replay. No se reportaron fallos, flakes, retries ni skips en ese run. Este fue el gate CORE previo a integrar UI/seed F9; no era el gate de release combinado ni release a producción. La migración candidata es `0023_phase9_certificates.sql` (journal `idx: 23`, ledger resultante 24), probada solo en QA aislada y no aplicada a canónico/cloud, que permanecen en ledger 23. En ese boundary, producción seguía en `master` `2789d55`.

### Release y validación post-release de Fase 9

El gate integrado PR 298/development `37987296020` pasó first-pass: 463 unit/4,031 assertions, 177 integración/1,452, F8 seed 1/897, F9 seed 1/142 y 145 E2E (76+69). PR 299 se liberó a `master` como `5b10162`; el CI del PR `37990141523` y el CI del source master `37992346935` son runs distintos, ambos first-pass. El master CI reportó 463 unit/4,031 assertions, 177 integración/1,452, F8 seed 1/897, F9 seed 1/142 y 145 E2E (76+69), sin fallos reportados. PR 300 corrigió el origen local de verificación del seed y PR 301 liberó la corrección final como `dc55620df325c69dfce0b3661527a1049e392fe5`. Los CI de release `37994666141`, `37995487281` y `37996321902` pasaron en el primer intento. En el gate final `37996321902`: 464 unit/4,033 assertions, 177 integración/1,452, F8 seed 1/897, F9 seed 1/142 y 145 E2E (76+69), sin fallos, flakes, retries ni skips reportados; quality/build PASS y typecheck 0 errores/0 warnings/354 hints. La migración `0023_phase9_certificates.sql` (SHA-256 `4c78ed1735b0cd3cb34d2bdc5f1f2c0d15b51dcc31568136839d706649489ee1`, timestamp `1791500766703`) avanzó el ledger a 24. El release CI no elimina los fallos/intermitencias históricos documentados en sus secciones originales.

La verificación pre/post de la migración cloud comparó hashes completos de fila: las 1,850 filas originales de 72 tablas se preservaron. Luego, el PLAN del demo F9 usó un baseline post-migración de 77 tablas/1,852 filas originales; APPLY preservó hashes completos de todas ellas y dejó 1,987 filas totales. PLAN `37993861130` y APPLY `37994003423` se ejecutaron por separado del release. El rerun no modificó el dataset. Ledger 24 y ocho certificados demo quedaron con estados esperados: 2 generados, 2 pendientes de revisión, 2 emitidos, 1 revocado y 1 reemplazado. Las páginas públicas de los ocho registros devolvieron HTTP 200 con estados correctos. El acceso anónimo al PDF privado devolvió 303. Los hashes de metadatos públicos coincidieron; no se descargaron bytes privados para verificación independiente del archivo. No afirmar validación de firma física, certificado institucional real ni hash de bytes del PDF privado cloud.

Evidencia cloud de operador: `phase9-production-release-evidence/summary.json`, archivos `fix-origin-*` y outputs privados del workflow F9; no contiene valores de secretos publicables.

La medición local anterior (migración sin reset, 75 tablas/3,878 filas con digests conservados) es un boundary histórico y fue supersedida por un reset/reconstrucción que el usuario autorizó expresamente ante hashes de migraciones 0003/0005/0008 sin origen identificado. No se afirma preservación de la base local anterior: sus datos fueron reemplazados en el reset aprobado. La instancia local canónica se reconstruyó con el source completo hasta ledger 24 y el demo actual registra 8 cursos, 10 grupos, 25 participantes, 26 registros, 12 intereses y 8 certificados. Una lectura posterior registró 8 certificados, 1 configuración, 15 artefactos, 33 eventos y 32 receipts con ledger 24 en DB `55322`. Las ocho páginas de verificación pública respondieron 200. Se verificaron los bytes, SHA-256 y sello DEMO de seis PDFs finales privados; no se extrapola esa verificación a los demás estados. No se afirma haber corrido una suite nueva de idempotencia local. La verificación local tampoco representa certificados institucionales reales.

La app nueva se relanzó en `http://127.0.0.1:4321` y responde HTTP 200 en login; no se capturó el PID Bun. El operador reportó que pausó previamente el proceso que entonces identificó como PID 8204; ese dato es histórico y no identifica al propietario actual del puerto. El Supabase local reconstruido usa API `localhost:54321`, DB `localhost:55322`; el entorno paralelo `skillbase_demo_f9_clean_20261009` (API 60421, DB 60422) sigue como fallback con su app pausada. HTTP 200 en login no equivale a sesión autenticada. OAuth local alcanzó un redirect 302 al callback `http://127.0.0.1:54321/auth/v1/callback` y la página de Google cargó 200 sin error de redirect observado; no se completó consentimiento real, callback PKCE o sesión. El usuario Google previamente vinculado se perdió con el reset; una cuenta de prueba requiere invitación/rol legítimos, sin asignar ADMIN automáticamente. Recovery end-to-end local y cloud permanecen pendientes.

El archivo de handoff de credenciales está en `C:/Users/Steve/AppData/Local/Temp/opencode/skillbase-demo-access/original-local-f9-credentials.json`, ACL privada del propietario. No copiar sus datos/secretos a documentación o Git.

### Notas de cronología E2E que no se atribuyen como defectos resueltos

El gate combinado anterior fue limpio, pero no cambia la causalidad de observaciones históricas. El caso de registro con SSR pendiente/interceptores de test fue acotado a su fixture/interceptor; la causa interna previa no se estableció. La temporización de cierre del toggle de teclado en público-interés y la readiness de `PageDown` en calendario tampoco tienen causa raíz confirmada. Una revisión controlada del planificador de días confirmó el montaje tardío del campo y persistencia/format esperado antes/después (2/2); no atribuir retroactivamente a ese cambio todos los fallos históricos de CI. No aumentar timeouts globales ni reclasificar fallos sin evidencia. El historial específico del calendario permanece arriba.
