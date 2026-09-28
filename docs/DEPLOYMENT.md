# DEPLOYMENT

## OBJETIVO

Definir CI/CD y despliegue de producción.

## RAMAS

### development

Integración del desarrollo.

### master

Producción.

Un push a `master` ejecuta los gates y, si todos pasan, aplica migraciones y despliega a producción. Los pull requests a `master` ejecutan los gates, pero no despliegan.

## GITHUB ACTIONS

### Gates obligatorios

- install reproducible;
- lint;
- format check;
- typecheck;
- tests;
- build.

### Tests

Según estructura final:

- unit;
- integration;
- E2E.

## JOBS

El workflow tiene tres jobs:

- `quality`: instalación congelada, `bun run check` (lint, formato y typecheck), unit tests y build; no necesita Docker.
- `integration-e2e`: instala Chromium y ejecuta los comandos `bun run test:integration` y `bun run test:e2e`. Cada runner crea y limpia su propio proyecto Supabase temporal con puertos dedicados; no se comparte ni se prepara un stack de desarrollo.
- `deploy`: solo para push a `master`, depende de que `quality` e `integration-e2e` terminen correctamente. Aplica migraciones y despliega el output de producción con Vercel.

## DOCKER EN CI

Principios:

- imágenes oficiales;
- versiones fijadas;
- servicios mínimos;
- no usar contenedores innecesarios;
- no descargar browsers que no se ejecutarán;
- usar cache con cuidado;
- evitar imágenes custom grandes salvo necesidad real.

Docker se utiliza en `integration-e2e` porque ambos runners arrancan stacks Supabase aislados. No ejecutar `supabase start`, `db:reset` ni `supabase stop` por separado en CI: los runners son responsables del ciclo de vida y sus errores de CLI no imprimen la salida que podría revelar keys. La instalación de Playwright descarga únicamente Chromium y sus dependencias del sistema.

## MASTER PIPELINE OBJETIVO

```text
push master
→ quality (install, static checks, unit tests, build)
→ integration-e2e (isolated Supabase integration and E2E tests)
→ apply Drizzle migrations
→ pull Vercel production configuration
→ Vercel production build and deploy
```

El job de despliegue está condicionado explícitamente al evento push en `master` y al éxito de ambos jobs de gates. Cualquier fallo o job no exitoso bloquea el despliegue. Los pull requests nunca reciben el job de despliegue.

## MIGRACIONES

Las migraciones viven versionadas en Git.

El job actual ejecuta `bunx drizzle-kit migrate` con `MIGRATION_DATABASE_URL` y detiene el despliegue si falla. Drizzle consulta el historial y aplica las migraciones versionadas que estén pendientes; no hay un paso separado de previsualización/verificación.

En el workflow actual:

1. `MIGRATION_DATABASE_URL` conecta al proyecto Supabase de producción desde un GitHub Environment secret;
2. Drizzle compara el historial y aplica migraciones versionadas pendientes;
3. el fallo de migración termina el job antes de cualquier paso Vercel.

Después de tener datos productivos:

- evitar cambios destructivos directos;
- usar expand/contract cuando sea necesario;
- mantener compatibilidad durante despliegue.

## VERCEL

Vercel CLI debe existir como dependencia del proyecto.

El proyecto debe poder enlazarse mediante un script equivalente a:

```text
bun run vercel:link
```

El deploy de `master` debe ocurrir después de CI, no en paralelo.

## SECRETS

GitHub Secrets esperados conceptualmente:

- credenciales Supabase necesarias para migraciones;
- Vercel token;
- Vercel org/project identifiers;
- otros secretos estrictamente necesarios.

Nunca imprimir secretos en logs.

## PREVIEWS

Los previews pueden utilizarse para revisión visual y demostraciones.

No deben apuntar accidentalmente a la base de producción con permisos de escritura amplia.

## ROLLBACK

Antes del lanzamiento real debe existir estrategia para:

- rollback de aplicación;
- recuperación ante migración fallida;
- backup de base;
- restauración de archivos críticos.

## OBSERVABILIDAD

Como mínimo:

- logs de errores;
- identificación de release;
- errores de migración;
- errores de deploy.

Agregar herramientas externas únicamente cuando exista beneficio claro.

Las lecturas de cursos y los pasos de autenticación registran un aviso `[slow-operation]` cuando permanecen pendientes más de 5 segundos, y otro al terminar. El middleware mide el render SSR por ruta normalizada (sin IDs, slugs, credenciales ni datos personales). Ante un 504, buscar el aviso previo en los logs de la misma invocación de Vercel para distinguir Auth, persistencia y render; este diagnóstico no cancela solicitudes ni sustituye límites de tiempo en las dependencias.

Las trazas posteriores confirmaron que el preflight de conexión introducido en la primera mitigación no bastaba: las solicitudes seguían pendientes en lecturas PostgreSQL hasta el 504 de 300 segundos, mientras el servidor PostgreSQL no ejecutaba consultas largas. El cliente PostgreSQL del runtime ahora vive solo durante una petición y se cierra al terminar; no se reutilizan sockets entre activaciones de la función. Las peticiones GET con acceso a base cierran la conexión tras 15 segundos para que una lectura colgada falle en lugar de ocupar la función 300 segundos. El cliente limita el pipelining a una consulta para el pooler transaccional. La ejecución de consultas es aislada por petición; las escrituras no se reintentan automáticamente para evitar duplicaciones.

## PIPELINE IMPLEMENTADO

`.github/workflows/ci.yml` se ejecuta únicamente en:

- push a `master`;
- pull request cuyo destino sea `master`.

El job `quality` instala con lockfile y ejecuta checks estáticos, unit tests y build sin levantar Docker. Sus valores públicos de Supabase y base de datos son placeholders de build, no credenciales.

El job `integration-e2e` instala Chromium y ejecuta los runners aislados. `test:integration` y `test:e2e` crean cada uno su propio stack temporal, asignan puertos/credenciales temporales, aplican migraciones Drizzle y limpian el proyecto al terminar. El runner inyecta placeholders locales para las variables de proveedor Google requeridas por la configuración Supabase; no usa OAuth real. No se inyectan credenciales del stack de desarrollo ni se ejecuta `db:reset`. La salida de error de comandos Supabase se retiene para evitar que keys locales aparezcan en los logs.

El proyecto cloud Supabase `SkillBase` (`fvzxqlezdrlzykyoevub`) y el proyecto Vercel `stevecasto-projects/skillbase` están enlazados. El dominio de producción es `https://skillbase-alpha.vercel.app`; `skillbase.vercel.app` no está disponible porque pertenece a otra cuenta.

Por petición explícita se cargaron manualmente en producción los dos formatos de ejemplo de 20 y 30 horas (80/100 y 120/150 BOB) y los cinco cursos sintéticos de `seed-demo`, todos en estado `DRAFT` y sin destacado. El formato local adicional `Promedio` no se cargó. Esta carga puntual no forma parte de las migraciones ni del despliegue automático; los ejemplos no constituyen oferta académica aprobada y solo pueden mostrarse públicamente mediante publicación administrativa posterior.

### Reconciliación manual de los cinco demos cloud

La herramienta `scripts/reconcile-production-demo-courses.ts` es independiente del reconciliador **solo local**. No forma parte de CI ni de migraciones. Usa exclusivamente `supabase db query --linked --project-ref fvzxqlezdrlzykyoevub`; exige que el proyecto enlazado coincida y nunca usa `DATABASE_URL`. Primero ejecutar **solo lectura**:

```text
bun scripts/reconcile-production-demo-courses.ts
```

La salida enumera los campos/fechas anteriores y propuestos, los grupos, el hash SHA-256 y la ruta de un snapshot completo (cursos, revisiones, grupos y auditoría pertinente) bajo el directorio privado del usuario **fuera del repositorio**. Guardar ese archivo, revisar los cambios manualmente y comprobar que la migración 0009 está aplicada. Los eventos de edición de calendario existentes requieren aceptación específica; no asumir que los demos publicados reflejan una oferta aprobada. Solo si el responsable autoriza expresamente la sustitución de las fechas editadas y confirma el usuario interno `ACTIVE`/`ADMIN`, usar:

```text
bun scripts/reconcile-production-demo-courses.ts --apply --confirm-project-ref fvzxqlezdrlzykyoevub --actor-id UUID --snapshot "RUTA_ABSOLUTA_DEL_SNAPSHOT" --expected-snapshot-hash SHA256 --accept-edited-calendars
```

Omitir `--accept-edited-calendars` cuando no hay ediciones de calendario auditadas. La aplicación revalida el snapshot bajo locks en una única operación SQL atómica; cualquier cambio posterior o grupo inesperado impide escribir. Si ya se aplicó el mismo snapshot, repetir **el mismo comando apply** responde sin nuevas escrituras/auditorías. Verificar el resultado mediante las vistas administrativas; el comando preview está pensado para el estado previo y rechaza grupos existentes. Ante error o discrepancia, no repetir con un hash anterior: investigar primero y crear un preview nuevo solo si los grupos continúan ausentes. No pegar el snapshot ni la salida de la CLI en tickets o logs públicos; el backup local no equivale al backup/PITR gestionado de producción.

El job `deploy` se ejecuta únicamente en pushes a `master`, y su condición requiere éxito explícito de `quality` e `integration-e2e`. Aplica migraciones Drizzle y despliega el output preconstruido con Vercel CLI. La integración Git automática de Vercel está desconectada para impedir despliegues paralelos que omitan estos gates.

Los placeholders públicos de build están limitados a `quality`; los runners de integración inyectan sus propios endpoints/keys temporales. `deploy` descarga su entorno de producción desde Vercel para evitar que valores locales sobrescriban URLs, claves públicas o conexiones del build final.

Las variables públicas se incorporan durante el build desde la configuración descargada. `DATABASE_URL` se lee desde `process.env` en runtime, porque Vercel no revela valores sensibles al construir output prebuilt y los inyecta únicamente en la función desplegada.

El environment GitHub `production` restringe despliegues a ramas protegidas y contiene:

- `DATABASE_URL`: conexión de runtime mediante pooler compatible con serverless, configurada en Vercel;
- `MIGRATION_DATABASE_URL`: conexión de sesión con permiso para migraciones, almacenada como GitHub Environment secret;
- `VERCEL_TOKEN`: GitHub Environment secret;
- `VERCEL_ORG_ID`: GitHub Environment variable;
- `VERCEL_PROJECT_ID`: GitHub Environment variable.

La subida de artwork requiere además una clave privada de Supabase en Vercel Production (`SUPABASE_SERVICE_ROLE_KEY`, valor de una clave moderna `sb_secret_...`). Sin ella, el endpoint de imagen responde 500. El bucket `course-artwork` se prepara/valida server-side con acceso público de lectura, solo WebP y límite de 4 MiB. La variable se configuró y se redeplegó el mismo artefacto de producción después de detectar su ausencia; la clave no debe registrarse ni entregarse al cliente.

Vercel usa el preset Astro, Bun con lockfile congelado y Node.js 24. El proyecto usa el adapter oficial con salida server-side. No se generan previews automáticos ni se entregan credenciales de producción a ramas de feature.

## CONEXIONES POSTGRESQL EN SERVERLESS

En Vercel, `DATABASE_URL` debe apuntar al pooler de Supabase apropiado para runtime serverless. El singleton por módulo limita cada instancia de función a una conexión (`max: 1`) y libera conexiones inactivas; esto reduce presión, pero no reemplaza el pooler porque Vercel puede ejecutar múltiples instancias.

`MIGRATION_DATABASE_URL` utiliza el pooler en session mode para conservar una sesión PostgreSQL durante las migraciones de Drizzle. No ejecutar migraciones mediante el pooler en transaction mode. Localmente ambas URLs pueden apuntar a `127.0.0.1:54322`.

Antes de habilitar Auth cloud se debe verificar explícitamente:

- signup público por email/password deshabilitado;
- únicamente Google entre los proveedores previstos;
- Site URL y callback allowlist exactos;
- variables públicas y privadas asignadas al entorno correcto sin exponer secretos.

Estas comprobaciones quedaron aplicadas durante la Fase 1. La clave legacy `service_role` debe rotarse o deshabilitarse antes de operar con datos reales porque una inspección inicial del CLI la mostró completa aun sin solicitar `--reveal`.
