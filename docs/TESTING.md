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

`tests/fixtures/setup-auth.ts` crea identidades locales confirmadas mediante la Admin API de Supabase y perfiles internos deterministas para ADMIN, INSTRUCTOR, multirol y DISABLED, además de una identidad desconocida. Las credenciales son datos ficticios exclusivos de test. El setup obtiene URL y keys de `supabase status --output env` sin imprimirlas; ninguna service-role key llega al web server ni al browser.

`bun run test:e2e` usa un runner que inyecta esa configuración solo al proceso Playwright. Los tests generan enlaces de un solo uso mediante Admin API y canjean el token con el adaptador cookie oficial de SSR, sin ofrecer login por email en `/login` ni visitar Google. El seed de desarrollo y los fixtures de test permanecen separados.

La cobertura de Auth incluye redirects no autenticados, roles individuales y múltiples, denegación por URL directa, identidad deshabilitada/desconocida, vinculación y restricciones DB, y cierre de solamente la sesión actual.

También se verifica signup público deshabilitado, creación de fixture por Admin API, usuario activo sin roles, motivos exactos de denegación, políticas fail-closed, opciones de cookies, cache privado, origen de acciones Auth, reemplazo exacto de roles y vinculación concurrente. Los escenarios server-side se ejecutan una vez en Chromium desktop; mobile conserva únicamente Foundation y un smoke de navegación privada.

## GATES

No desplegar `master` si falla:

- lint;
- typecheck;
- tests obligatorios;
- build.

Un fallo de CI debe considerarse bloqueo de release.
