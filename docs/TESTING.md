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

| Comando                    | Alcance                                                 | Infraestructura |
| -------------------------- | ------------------------------------------------------- | --------------- |
| `bun run test`             | Alias de unit tests                                     | Ninguna         |
| `bun run test:unit`        | Utilidades y comportamiento puro                        | Ninguna         |
| `bun run test:integration` | Conectividad y acceso tipado con Drizzle                | Supabase local  |
| `bun run test:e2e`         | UI en Chromium; Playwright inicia Astro automáticamente | Chromium        |
| `bun run test:all`         | Unit, integration y E2E                                 | Supabase local  |
| `bun run check`            | ESLint, Prettier check y Astro check                    | Ninguna         |
| `bun run validate`         | Checks, todas las pruebas y build                       | Supabase local  |

Antes de integración, ejecutar `bun run supabase:start` y `bun run db:reset`. Instalar el único navegador requerido con `bunx playwright install chromium`.

### Fixtures Auth de Fase 1

`tests/fixtures/setup-auth.ts` crea identidades locales confirmadas mediante la Admin API de Supabase y perfiles internos deterministas para ADMIN, INSTRUCTOR, multirol y DISABLED, además de una identidad desconocida. Las credenciales son datos ficticios exclusivos de test. El setup obtiene URL y keys de `supabase status --output env` sin imprimirlas. Una service-role key local se usa únicamente en el proceso servidor E2E aislado descrito a continuación; nunca llega al browser.

`bun run test:e2e` usa un runner que inyecta URL/keys locales y `TEST_DATABASE_URL` únicamente al proceso Playwright. El Playwright config pasa su service-role key local como `SUPABASE_SERVICE_ROLE_KEY` al proceso dedicado del web server E2E para que el endpoint autenticado de artwork pueda escribir en Storage; no se entrega a páginas/navegador. Los tests generan enlaces de un solo uso mediante Admin API y canjean el token con el adaptador cookie oficial de SSR, sin ofrecer login por email en `/login` ni visitar Google. El seed de desarrollo y los fixtures de test permanecen separados.

La cobertura de Auth incluye redirects no autenticados, roles individuales y múltiples, denegación por URL directa, identidad deshabilitada/desconocida, vinculación y restricciones DB, y cierre de solamente la sesión actual.

También se verifica signup público deshabilitado, creación de fixture por Admin API, usuario activo sin roles, motivos exactos de denegación, políticas fail-closed, opciones de cookies, cache privado, origen de acciones Auth, reemplazo exacto de roles y vinculación concurrente. Los escenarios server-side se ejecutan una vez en Chromium desktop; mobile conserva únicamente Foundation y un smoke de navegación privada.

### Cobertura Courses de Fase 2A

- Unit cubre validación de campos, niveles, dinero decimal, fechas civiles Bolivia estrictas y simétricas, ventana opcional, nota explícita —incluido cero—, slug, transiciones, autorización activa, logging sanitizado y disponibilidad derivada.
- Integration usa Supabase local para verificar schema, checks, índices de FK/consulta, RLS, privilegios, rollback atómico, auditoría exacta, validación transaccional de precios, concurrencia de slugs solapados, revisión optimista, persistencia UTC y proyecciones públicas.
- E2E usa los usuarios Auth controlados existentes y recorre validación con valores preservados, creación, reedición sin desplazamiento horario, edición, publicación, retiro y archivo mediante Post/Redirect/Get. La gestión de formatos se comprueba sin JavaScript; el formulario de cursos usa islas React para selectores y calendario. También se verifica denegación a instructor, protección de origen, layout mobile sin overflow y foco por teclado.
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
- Las pruebas de integración de cursos cubren migración/modelo de formatos, términos y revisiones, cambios que actualizan borradores pero no publicaciones/archivados, precios históricos, y límite único del destacado publicado.
- `tests/e2e/public-courses.spec.ts` verifica SSR público, catálogo/detalle, estados y 404 uniforme; `tests/e2e/courses.spec.ts` amplía los flujos administrativos de formato, contenido, imagen y autorización. `tests/e2e/private-sidebar.spec.ts` cubre rail/overlay, roles, scroll independiente, teclado y movimiento reducido.
- Los escenarios E2E comparten una base local y un curso destacado singleton: Playwright corre con `workers: 1` y `fullyParallel: false` para evitar interferencia entre fixtures.
- La existencia de cobertura en el árbol no acredita por sí sola ejecución reciente de la suite, CI remoto, aplicación de migraciones cloud ni despliegue. Esos resultados se anotan solo después de ejecutarlos/verificarlos.

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
