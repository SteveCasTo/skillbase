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

La carga demo de producción es una operación separada mediante `production-demo.yml`, **solo workflow_dispatch en master** y environment `production`, no un paso de deploy. Reutiliza `MIGRATION_DATABASE_URL` sin leer/exportar su valor, una clave servidor existente cifrada `DEMO_SUPABASE_SERVICE_ROLE_KEY` y el actor existente `DEMO_ADMIN_ID`. PLAN por defecto precede a APPLY explícito; respeta concurrencia sin cancelación, guards de proyecto/actor/provenance y todos los datos anteriores. No crea secretos de DB nuevos ni rota passwords, y no publica endpoints de seed/exfiltración. Operación y prerrequisitos en `docs/FINANCIAL_DEMO.md`.

El workflow separado `production-comprehensive-demo.yml` también es manual y
`master`-only, pero dedicado a datos sintéticos F1–F8. Requiere environment
protegido `production`, revisa CI/deployment del SHA y el hash PLAN aprobado,
compara preservación por hashes server-side y exige APPLY/replay idempotente.
No está en el DAG de deploy ni se ejecuta en CI ordinaria/Vercel. Contrato,
secret-handling, operación y evidencia están en [`DEMO_SEED.md`](DEMO_SEED.md).

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

### Shards E2E aislados — PR 279 integrado en development

El usuario aprobó dos jobs E2E concurrentes en runners separados, cada uno con stack Supabase/Auth/DB y servidor Astro propios, conservando workers=1 y `fullyParallel=false`. PR 279 integró el workflow a `development`: integration corre una vez, E2E se divide en shards 1/2 y 2/2, y el agregador `integration-e2e` always-run exige éxito de `quality`, integration y ambos shards. Deploy sigue master-only y gated; secrets y branch protections no cambiaron.

PR 279 integró la rama `chore/isolated-e2e-shards` (base `development` `510e62d`). `development` no tiene enforcement efectivo de branch protection para los checks E2E nuevos; el operador revisó todos los estados requeridos antes del merge. La lista de 134 identidades (126 Chromium + 8 mobile, shards 69 y 57+8) y el test sintético de los 16 pares de estados son verificaciones previas; el CI remoto final real está debajo. No se promueve esta mejora de CI por separado a master. Metodología y límites en [`TESTING.md`](TESTING.md).

Run `37675836980` fue el primer candidato verde (371 unit, 142 integration, 134 E2E). Un intento posterior quedó incompleto por APT; PR 279 corrigió provisioning y el CI final `37684331005` pasó 376 unit/2266 assertions, 142 integration/1077 y 134/134 E2E en shards separados, first-pass sin retry/flake. `quality`, integration y agregador estricto pasaron. Una observación de duración previa dio E2E envelope 460 s baseline vs. 387 s candidato, critical path sin cola inicial 730 vs. 426 s, y runner time no-deploy 789 s vs. 931 s (más consumo agregado con concurrencia); hosts/redes difieren. No afirmar beneficio robusto ni 2× a partir de una sola medición. Evidencia y cronología en [`TESTING.md`](TESTING.md).

Run intermedio `37678477638` se canceló en provisioning APT: quality 375 unit e integration 142 pasaron, shard 1 cubrió 69 tests y shard 2 cero; agregador falló/deploy fue omitido. Logs mostraron espera hacia Azure HTTP sin identificar causa DNS/socket específica. La remediation de PR 279 usó Ubuntu 24.04, sources oficiales HTTPS y límites APT/install fail-closed; CI final `37684331005` completó provisioning/test en ambos shards. Esto prueba el comportamiento en esa ejecución, no inmunidad futura a fallos externos.

El proyecto cloud Supabase `SkillBase` (`fvzxqlezdrlzykyoevub`) y el proyecto Vercel `stevecasto-projects/skillbase` están enlazados. El dominio de producción es `https://skillbase-alpha.vercel.app`; `skillbase.vercel.app` no está disponible porque pertenece a otra cuenta.

Por petición explícita se cargaron manualmente en producción los dos formatos de ejemplo de 20 y 30 horas (80/100 y 120/150 BOB) y los cinco cursos sintéticos de `seed-demo`. El formato local adicional `Promedio` no se cargó. Esta carga puntual no forma parte de las migraciones ni del despliegue automático. Cuatro demos están publicados y `demo-gestion-de-proyectos` permanece en borrador; su estado editorial no se cambia durante la reconciliación.

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

El 28 de septiembre de 2026 se aplicó esta reconciliación a los cinco demos cloud después del despliegue del PR #100. El snapshot privado previo permanece fuera del repositorio. Se comprobaron cinco calendarios L–V, seis grupos (cinco marcados como publicados y uno de borrador), la conservación de todos los demás campos de curso, revisiones de formato y eventos de auditoría anteriores, y las cuatro fichas públicas sin horas ni horario heredado. La cartelera pública tampoco muestra fechas; las fechas se consultan en cada ficha.

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

`MIGRATION_DATABASE_URL` utiliza el pooler en session mode para conservar una sesión PostgreSQL durante las migraciones de Drizzle. No ejecutar migraciones mediante el pooler en transaction mode. En la configuración Supabase local actual, `DATABASE_URL` y `MIGRATION_DATABASE_URL` apuntan a `127.0.0.1:55322`; API/Auth local usa `http://127.0.0.1:55321` y la aplicación web `http://127.0.0.1:4321`. Los puertos Supabase se movieron desde 54322/54321 por el rango TCP reservado de Windows 54296–54395. `supabase/config.toml` y `.env.example` contienen la configuración actual; no confundir con evidencia histórica anterior al cambio de puertos.

Antes de habilitar Auth cloud se debe verificar explícitamente:

- signup público deshabilitado; email/password solo para cuentas internas preaprovisionadas y Google solo mediante identidad/invitación autorizada;
- Site URL y callback allowlist exactos;
- variables públicas y privadas asignadas al entorno correcto sin exponer secretos.

La configuración descrita en el registro histórico de Fase 1/3 no acreditaba Auth dual; PR 126 aplicó la configuración de Fase 4 y su estado actual está documentado en «Estado Auth cloud tras PR 126». La clave legacy `service_role` debe rotarse o deshabilitarse antes de operar con datos reales porque una inspección inicial del CLI la mostró completa aun sin solicitar `--reveal`.

## REGISTRO PÚBLICO DE INTERESADOS: LOCAL LISTO, CLOUD PENDIENTE

El POST público de interesados requiere `INTEREST_RATE_LIMIT_SECRET` server-only, generado fuera de la aplicación con al menos 32 caracteres; nunca debe tener prefijo `PUBLIC_`, registrarse en logs o llegar al navegador. `INTEREST_RATE_COURSE_LIMIT`/`INTEREST_RATE_COURSE_SECONDS` y `INTEREST_RATE_NETWORK_LIMIT`/`INTEREST_RATE_NETWORK_SECONDS` son enteros positivos opcionales; defaults técnicos: 20/600 y 100/3600. No son cuotas comerciales.

El adaptador debe proporcionar una dirección confiable mediante `Astro.clientAddress`. La aplicación valida que el dato sea IP y calcula HMAC para el limiter persistente. Si el secreto falta/es inválido o no hay IP confiable, el POST falla cerrado. En local el secreto está configurado únicamente en el `.env` ignorado y se verificó el smoke con loopback; no se guarda ni imprime su valor. Se verificó la presencia del secreto en Vercel Production y Preview sin revelar su contenido. Antes de habilitar el endpoint en un entorno desplegado hay que probar ambas fuentes en runtime. Los tests usan secreto efímero propio del stack temporal, no un secreto persistente.

La migración 0011 se aplicó al Supabase local estándar `127.0.0.1:54322` mediante Drizzle sin reset; el rerun idempotente conservó los datos y verificó checksum/ledger según `docs/PLAN.md`. No se afirma que se haya aplicado a Supabase cloud; aplicar migraciones cloud requiere su propio flujo autorizado y evidencia.

El estado local/cloud de Fase 3 y la migración 0011 se registra en `docs/PLAN.md`; no aplicar manualmente su SQL ni inferir despliegue cloud a partir del estado local.

### Estado cloud registrado (2026-10-01)

- El proyecto Supabase canónico `SkillBase` (`fvzxqlezdrlzykyoevub`) está `ACTIVE_HEALTHY` y su URL pública coincide con Production de Vercel. El ledger cloud contiene 0000–0009 y sus hashes/timestamps corresponden al historial local; las migraciones aditivas 0010 y 0011 siguen pendientes en cloud.
- `INTEREST_RATE_LIMIT_SECRET` está configurado por separado en Vercel Production y Preview, con generación aleatoria de 64 caracteres; solo se verificó presencia, nunca se leyó/imprimió su valor. Preview contiene únicamente este secreto para esta feature: no se le asignaron credenciales DB ni se creó un despliegue Preview funcional.
- El adapter Astro/Vercel provee `Astro.clientAddress`; Vercel sobrescribe el primer `X-Forwarded-For`, y la aplicación valida la IP con `net.isIP`. Esto valida la cadena de confianza estáticamente, no el comportamiento de un POST contra la versión cloud desplegada. Referencias: [Vercel request headers](https://vercel.com/docs/headers/request-headers), [Astro `clientAddress`](https://docs.astro.build/en/reference/api-reference/#clientaddress), [Astro Vercel adapter](https://docs.astro.build/en/guides/integrations-guide/vercel/).
- La producción existente permanece `READY` en SHA `3a5258a` en `https://skillbase-alpha.vercel.app`; es anterior al flujo de interesados. No se creó un nuevo deployment ni se verificó allí el POST o un ataque con forwarded header.
- La integración Git de Vercel está desconectada. La CI ejecuta quality e integration/E2E en pull requests dirigidos a `master`; `deploy` ocurre solo tras push a `master` y depende del éxito de ambos jobs. El secreto GitHub `production` `MIGRATION_DATABASE_URL` solo está disponible para ese workflow autorizado; no se intentó leer ni revelar. El entorno Vercel se inspeccionó sin extraer valores de conexión.
- `master` requiere checks `quality` e `integration-e2e`, una aprobación y resolución lineal; enforcement a administradores está desactivado. Un administrador puede omitir la aprobación, pero no saltarse checks fallidos. Esta es la configuración observada, no una recomendación de bypass ni evidencia de release.

La configuración cloud de secreto y cadena confiable queda preparada/verificada de forma estática, pero la migración cloud y la verificación runtime continúan pendientes. No afirmar que la feature está operativa en producción hasta aplicar migraciones mediante el flujo autorizado, desplegar y comprobar GET/POST, `no-store`, limitación y rechazo de spoofing.

### Cierre de release Fase 3 (2026-10-02)

Esta actualización supersede el estado pendiente registrado el 2026-10-01, sin reescribirlo como si las verificaciones ya hubieran ocurrido entonces.

- PR 112 (normalización del test de auditoría) se integró a `development`; PR 113 se integró a `master` como `8f5bb2dc45ad373ff12aefd6325456885b20d5c6`.
- CI del PR 112, run `36827391089`: `quality` e `integration-e2e` PASS. CI de push a `master`, run `36828194127`: `quality`, `integration-e2e` y `deploy` PASS; integration 65/65, E2E 96/96 sin flaky.
- Vercel deploy `dpl_2kB2xrbE6ppxF4KYPVuR6cpfty9k` terminó `READY` y asignó el alias `https://skillbase-alpha.vercel.app`.
- Supabase `SkillBase` (`fvzxqlezdrlzykyoevub`) está `ACTIVE_HEALTHY`; ledger Drizzle 0000–0011 con hashes y timestamps coincidentes con el repositorio. 0010/0011 se aplicaron por el pipeline; tablas de interesados y rate limits con RLS/revocaciones verificados.
- Smoke público: landing, catálogo y detalle/formulario respondieron 200. Alta y duplicado devolvieron el mismo 200 neutro con `no-store`, dejando una fila. Dos `X-Forwarded-For` falsificados usaron el mismo bucket por red/curso (contador 2 por scope), mostrando que el header no anula `Astro.clientAddress`. No se realizó stress 429 ni verificación de HMAC con una IP real. Se eliminó el único interesado sintético; quedan 0 filas y 2 buckets técnicos con TTL.
- Una petición privada anónima a `/app/interesados` redirigió 303 a login. No se hizo sesión ni prueba manual de interfaz como ADMIN en producción.

El secreto HMAC está presente en Production/Preview, con su contenido nunca leído ni registrado. Preview no tiene credenciales DB ni despliegue funcional. El smoke confirma únicamente los flujos públicos descritos; no afirmar una prueba manual administrativa en producción.

## FASE 4 — RELEASE EN PRODUCCIÓN

PR 124 sincronizó documentación a `development`; PR 125 preparó la ascendencia de release. PRs 118 (Auth), 120 (instructores/asignación), 121 (seed local), 122 (audit password) y 123 (guard 0015) están integrados en `development`; PR 126 liberó Fase 4 a `master` como `31623e708b1b3cef64d48c7ab3bdd17fec2bd394`. CI [`36951624627`](https://github.com/SteveCasTo/skillbase/actions/runs/36951624627) pasó `quality`, `integration-e2e` y `deploy`, full E2E 107/107. Una corrida anterior del PR tuvo dos tests flaky; no se afirma que nunca haya habido flakes. El [comentario de cierre de PR 126](https://github.com/SteveCasTo/skillbase/pull/126#issuecomment-5944446730) registra resultados/smoke. Vercel deployment `dpl_8d1Fd13g7s4CXE3VSMH21fbS1ysz` está `READY` y asociado a `https://skillbase-alpha.vercel.app`. Release de código/Fase 4 está desplegado y validado; entrega real Google/SMTP tiene las limitaciones indicadas abajo.

### Estado Auth cloud tras PR 126

El release aplicó 0012–0015 y configuró en Auth cloud el hook `before_user_created` a `private_auth.allow_invited_google_signup`, signup público deshabilitado, proveedor email, linking manual de Google, y redirects callback/recovery. En Vercel Production existe `AUTH_RATE_LIMIT_SECRET` de 64 caracteres, separado de `INTEREST_RATE_LIMIT_SECRET`; ambos permanecen server-only y nunca se leyeron/imprimieron. Secret de service-role y conexiones runtime/migración necesarios están configurados. Preview permaneció sin cambios y no tiene deployment funcional/DB secrets.

- OAuth Google real, vinculación mediante navegador real, SMTP propio y entrega del correo de recuperación no se probaron. No afirmar que “Forgot password” o la confirmación por email funcionen en producción sin configurar/probar SMTP y sus permisos/límites. Login inicial mediante password asignado por ADMIN no depende de SMTP; un ADMIN que solo usa Google y quiera agregar password mediante confirmación sí depende de email entregable.
- El smoke post-deploy de PR 126 probó acceso/password seeded, guardas y ownership de instructor, páginas públicas, POST/duplicado de interesado y `no-store`; no prueba los proveedores externos que quedaron explícitamente pendientes.

La asociación automática de Google por email verificado coincidente puede ocurrir en Supabase y no se documenta como deshabilitable. SkillBase aplica aprobación OAuth a nivel de aplicación (`approved_google_identity_id`); una identidad de proveedor presente no equivale a consentimiento/acceso, y una sesión PASSWORD sigue siendo independiente.

Después de PR 126, Supabase cloud canónico `fvzxqlezdrlzykyoevub` está `ACTIVE_HEALTHY` con ledger 0000–0015 (16 entradas, hashes/timestamps coincidentes con el repositorio); RLS, tablas/perfiles/assignment y permisos de Auth fueron aplicados por el release. El inventario anterior al renewal tenía un ADMIN y cinco cursos demo; el resultado posterior está abajo. En Vercel Production están presentes `AUTH_RATE_LIMIT_SECRET` (longitud comprobada de 64), el secreto de interesados y las credenciales de service-role/runtime/migración requeridas; ningún valor fue leído o impreso. Preview permaneció sin tocar. El custom SMTP no está configurado y la entrega de correo no está verificada.

### Seed y reset de desarrollo

`bun run db:seed:renew-demo` tiene tres modos: sin flags muestra el plan, `--apply` inserta solo entidades faltantes y `--apply --reset-application-data` renueva datos sintéticos. La CLI de mutación es exclusivamente local: exige Supabase canónico PostgreSQL `127.0.0.1:55322`/API `127.0.0.1:55321`, se niega en CI/Vercel/`NODE_ENV=production` y requiere ID de ADMIN interno activo más password externo de seed. No ejecutarla contra cloud ni quitar el guard local-only.

El reset local usa una allowlist explícita de tablas de aplicación (`interest_registrations`, `interest_registration_rate_limits`, `course_instructor_history`, `audit_events`, `groups`, `courses`, `course_type_revisions`, `course_types`) y `TRUNCATE ... RESTRICT`, nunca `CASCADE`. Preflight de colisiones de email/Auth ownership se hace antes del reset; los IDs de entidades/eventos son deterministas y las cuentas instructor se identifican mediante `app_metadata.seed_owner`. No usa hashes de reset ni una tabla de metadata de reset. Preserva `auth.users`/identidades/sesiones, `users`, roles, perfiles instructor, configuración Auth, migration ledger y Storage. Credenciales/ID del actor solo desde `.env` ignorado (`SEED_INSTRUCTOR_PASSWORD`, `SEED_ADMIN_ID`); no documentar ni imprimir sus valores.

### Renovación manual de datos en producción (realizada para PR 126)

La renovación del set demo de PR 126 se hizo manualmente en producción, separada del deploy, con inventario/conteos antes y después. El before/after confirmó conteos idénticos de `auth.users`, usuarios/roles/perfiles, sesiones, Storage y migration ledger. Producción quedó con 2 formatos/revisiones, 3 perfiles instructor, 6 cursos (5 publicados/1 draft), 12 grupos, 6 historiales, 35 interesados (30 activos/5 cancelados) y 6 marcadores `DEMO_SEEDED`. El smoke posterior comprobó alta/duplicado de interés (ambos 200 neutro/`no-store`) y eliminó solo su registro sintético; el seed de 35, Auth y buckets TTL quedaron intactos. El detalle está en `docs/TESTING.md`.

La CLI `db:seed:renew-demo` sigue siendo estrictamente local y rechaza Vercel/production. No reutilizarla ni quitar el guard para operar contra cloud. Una futura renovación será manual, autorizada por separado, con pre/post conteos e inventario; limitar borrado a filas demo comprobadas y marcadores `DEMO_SEEDED`, preservar auditoría legítima, identidades/sesiones Auth, ADMIN, perfiles/roles, Storage y ledger. Si la propiedad sintética no se puede confirmar, detenerse; nunca automatizar reset en cada deployment.

### Reparación local del guard y migraciones

PR 123 añadió `0015_restore-format-deletion-guard.sql` y lo aplicó al Supabase local estándar; PR 126 aplicó 0012–0015 al Supabase cloud. Ambos ledgers Drizzle tienen 16 entradas. La migración forward vuelve a crear `public.reject_course_type_revision_mutation`: `UPDATE`/`DELETE` de revisión se rechaza salvo borrado autorizado dentro de transacción con `app.delete_unused_format_id` igual al formato y sin cursos que referencien sus revisiones.

La revisión comparativa del ledger local detectó hashes históricos distintos para 0003/0005/0008. No se modificaron esos SQL ni hashes ni se forzó ledger repair. El artefacto local anterior de 0003 contenía `DROP TABLE course_prices CASCADE` y no tenía newline final; el archivo actualmente versionado omite `CASCADE`. La función 0005 que se encontró instalada era anterior y no contenía la condición `app.delete_unused_format_id`; la 0015 corrige estado live sin editar 0005. El bloqueo que se observó al intentar preparar el seed procedía de ese guard de borrado incompleto, no de una verificación por hash del seed: la propiedad de datos sintéticos se comprueba mediante IDs/markers y metadata de Auth. El texto 0008 previamente aplicado no se recuperó; solo se constató equivalencia de schema. No inventar contenido de 0008 ni atribuir una causa no probada a las diferencias.

## Correcciones Fase 4: estado local tras PRs 134–136 (2026-10-02)

PR 134 (`b1855b1`) integró en `development` las correcciones de instructor lifecycle y UI; PR 135 (`ddd0f3d`) movió los puertos de Supabase local porque `54296–54395` está reservado en Windows; PR 136 (`8cdb38f`) integró la corrección final de middleware/password hydration. El Supabase local canónico queda con API/Auth `http://127.0.0.1:55321` y PostgreSQL `127.0.0.1:55322`; Astro permanece en `http://127.0.0.1:4321`. La base estándar local fue migrada sin reset de ledger 16 a 17 (0016 aplicada). El stack de pruebas aisladas también usa los puertos/ajustes nuevos.

La verificación de preservación antes/después mantuvo identidades Auth, ADMIN/roles, perfiles, sesiones, Storage y los seis cursos/35 interesados. Las diferencias esperadas fueron la entrada del ledger de migraciones y el timestamp de inicio de sesión del propio usuario sintético utilizado en el smoke. No se borraron ni recrearon esos datos. El smoke local PASS comprobó seis rutas/páginas públicas y siete comprobaciones de detalle/formulario/imagen; el instructor autenticado consultó sus cursos propios, perfil y página de password con 200, y rutas ADMIN respondieron 303. La sesión sintética se cerró. Ese smoke no describe el estado del servidor después de la corrida E2E final, que lo detuvo temporalmente; no inferir un PID/estado activo del smoke anterior.

Este estado local no era evidencia de escritura en cloud. En ese stage, `master`/producción permanecía en el release anterior de Fase 4 (`598b1f`, migraciones hasta 0015, ledger 16); no hubo deploy ni cambios cloud desde la validación local. La consola Google aún requiere autorizar manualmente el callback local actualizado `http://127.0.0.1:55321/auth/v1/callback`; no se afirma Google OAuth real. SMTP propio y entrega real de recovery no quedaron comprobados en ese stage.

#### Validación de la fuente más reciente

La fuente pre-port-fix completó unit 176, integration 98 y full E2E 119/119 (secuencia histórica en `docs/TESTING.md`). PR 135 reportó 177 unit, un test aislado de integración de puertos y quality/build PASS. Tras arreglar el warning/hidratación de middleware/password, el commit final `8735d676fe0d96e7230b4636efa8cb51045d1eca` (integrado por PR 136) pasó 178 unit, 98 integration, full E2E 120/120 y lint/format/typecheck/build/Drizzle/diff checks; sin avisos/errores de hidratación `Astro.session`/React. En ese momento no se hizo deployment; el release posterior de Fase 5 y estado cloud actual constan abajo.

## Fase 5: estado local y boundary cloud (2026-10-04)

PRs 173–180 integraron schema/application/settings/export generators y páginas/route policy de preinscripción, participantes y roster en `development`. Fase 5 se liberó en producción como `2e0eecb`; cloud quedó migrado hasta 0017 (ledger 18). La validación local reportada pasó 303 unit, 125 integration y full canonical E2E 125/125, más quality y revisión de screenshots responsive/temas. Ese baseline local preservó los datos previos y no acredita las correcciones UX posteriores ni Fase 6.

Este registro de producción refleja el boundary histórico anterior al release de Fase 6. Se supersede por el estado actual de producción de la sección «QA pre-release de correcciones (2026-10-06)» abajo; se conserva como evidencia de la validación previa.

La evidencia local histórica de Fase 6 quedó cerrada por conjunto de heads, no en un único E2E: unit 332 e integration 137 PASS en `4b331ff9`; E2E 126/127 PASS en `b681a365`, con un strict locator en test sin JavaScript. El test-only PR 209 (`082dbbf`) corrigió el locator y la ejecución focal pasó 1/1 sin retry; no se afirma full 127/127. Build, Drizzle y quality PASS en `b681a365`; typecheck cero errores/warnings y 204 hints. En ese momento la promoción estaba pendiente; Fase 6 se liberó después mediante PR 211. El estado de release vigente y la QA de correcciones se registran a continuación. Google OAuth real/callback local continúa pendiente e independiente de SMTP.

La validación visual no produjo escrituras ni reinició Supabase. Había un snapshot pre-visual de 39 tablas/ledger 20; la comparación hash posterior quedó bloqueada por Docker Desktop no disponible, así que no se afirma una verificación post-visual fresca. La base local requiere Docker para consultas de aplicación, pero la ejecución de CI/remota y los gates de release cloud son independientes de arrancar Docker en esta estación.

### Configuración SMTP (servicio y evidencia; sin release de código)

La configuración Gmail de Supabase Auth y la plantilla española de recovery se aplicaron al proyecto cloud con autorización, sin cambiar OAuth, signup, URLs ni límites. La configuración local está en `supabase/config.toml` y `supabase/templates/recovery.html`; las suites aisladas no reciben credenciales SMTP. Los secretos viven solo en los almacenes protegidos de Auth/entorno local ignorado; no documentar valores ni poner credenciales en GitHub Actions, Vercel o el frontend. Esta configuración no es un release de código.

La recepción de un correo SMTP de prueba fue confirmada por el usuario en la cuenta autorizada del entorno local. Esto verifica la ruta local de entrega, no el clic de recuperación/cambio de contraseña, la entrega cloud ni Google OAuth real. El callback local `http://127.0.0.1:55321/auth/v1/callback` aún requiere autorización manual en Google Console. La configuración cloud ya está aplicada; no se hizo ninguna operación adicional contra producción durante esta actualización documental.

## QA pre-release de correcciones — estado histórico previo a PR 228 (2026-10-06)

Producción continúa en el release de Fase 6, commit `3c6ae7e2cff74faeb2f0f7de05d63b753418df4a`, con cloud ledger 20. No se desplegó la serie de correcciones de `development`, no se aplicaron migraciones ni se realizaron operaciones de datos/seeds durante esta validación. La validación local no cambia ese boundary.

`development` está en `292c5d42e2babb51a96c558074ef0ac0e1c2b261` (PRs 219–226). PRs 219–223 contienen las correcciones funcionales; PRs 225/226 actualizaron solamente pruebas E2E. Desde el source de aplicación `eacf6feeb26d67da98e46195a07d8777dd180966` no cambiaron aplicación, schema ni dependencias. La calidad local final pasó lint, format, typecheck (0 errores/0 warnings/214 hints), unit (339/2046 assertions), integration (138/983 assertions), Drizzle check y build (27.51 s, sin warnings). La evidencia E2E permanece parcial: full run 99/130 PASS y corridas focales separadas; además queda una intermitencia sin causa raíz en el guardado de grupo. Detalle, cronología y límites en [`TESTING.md`](TESTING.md).

Este era el estado previo al release; lo supersede el cierre PR 228 a continuación. En ese momento el full gate E2E y CI remoto aún estaban pendientes. Las verificaciones externas de Auth y retención siguen pendientes según [`AUTHENTICATION.md`](AUTHENTICATION.md) y [`PLAN.md`](PLAN.md).

## Release de correcciones PR 228 (2026-10-07)

PR 228 se integró en `master` con SHA `3e6e3a45417e35d412dd8ece34dc90ecd7ccb8e0` a las `2026-10-07T02:01:05Z`. Tras pasar los checks CI, el usuario autorizó explícitamente omitir la aprobación administrativa configurada para el merge. No fue bypass de CI: los checks estaban verdes y no se modificaron las protecciones del repositorio.

- CI del PR `37558507699`: quality con 339 unit y 138 integration; E2E 129 PASS con un flaky automático en `public-interest` por submit-disabled que pasó tras retry. El focused retry-disabled posterior pasó 1/1 sin cambio de código ni causa raíz, por lo que el origen del flaky no se considera resuelto.
- CI de master `37559942423`: SUCCESS; 339 unit, 138 integration y full E2E 130/130 PASS, sin flakes reportados en esa corrida. Este resultado no elimina la observación previa de flaky ni la intermitencia local del guardado de grupo sin causa raíz.
- Vercel deployment `dpl_4VKVLtA5rP5YbP5y1Nymnc5TKMep` quedó `READY` para el SHA exacto de master y alias `https://skillbase-alpha.vercel.app`. El smoke reportado obtuvo 200 en rutas públicas/Auth y 303 a login en cuatro rutas privadas sin sesión.
- Las correcciones no añaden migración ni modifican schema. No se hicieron migraciones manuales, reseed u otras operaciones de datos en cloud para este release. Ledger y conteos cloud no se volvieron a verificar de forma independiente; ledger 20 es el baseline histórico conocido, no una medición de este release.

Esta nota pre-release quedó supersedida por PR 235 y se conserva como historia. Para el status actual del release Fase 7, ledger cloud y límites de verificación, ver la sección siguiente.

## Release Fase 7 — PR 235 (master `4afa485`)

PR 235 liberó `4afa4858c8279282a8d26ab4adfa7769e249432d` a producción. CI master run `37573738321`: SUCCESS, 343 unit/2080 assertions, 139 integration/1022 assertions y full E2E 132/132 PASS sin flakes reportados. El deployment Vercel `dpl_A9Av16T1DZvk19W1836VEuPimAGS` está `READY` para ese SHA con alias `https://skillbase-alpha.vercel.app`. Smoke post-release: rutas públicas/Auth 200 y cuatro rutas privadas anónimas 303 a login.

Migration 0020 se aplicó a cloud por el pipeline normal de release. No hubo SQL manual, seed/reseed ni creación de identidades o sesiones Auth; el pipeline aplicó el DDL autorizado. Una comprobación read-only posterior mediante Supabase CLI/Management API observó ledger 21, entrada 21 timestamp `1791341690577` y SHA-256 `ad01e4dea9f51c4d503eef524a458e9adffe4f90e37397c784b9ddffd25aa32b`. Las cinco tablas de evaluación existen vacías, con RLS, sin privilegios Data API para `anon`/`authenticated`/`service_role`; las seis funciones trigger no tienen grants `EXECUTE` para esos roles.

El inventario cloud post-release observó 11 cursos, 22 grupos, 15 preinscripciones y 12 movimientos de caja; 282 sesiones (280 originales, 2 reemplazos), 3 canceladas, 16 marcas de participantes y 5 de instructor. También se observaron 5 usuarios Auth, 10 sesiones, 1 ADMIN activo, 4 INSTRUCTOR activos, 2 objetos Storage y un registro en cada tabla de settings. El conteo previo documentado de marcas de instructor era 4; no existe un snapshot cloud comparable anterior a esta migración, por lo que no se atribuye la diferencia al release. No se incluyen PII, nombres, IDs ni tokens.

Para el release F7 de PR 278, la consulta cloud fue read-only y no comparó hashes pre/post de todas las filas; no atribuirle esa prueba de preservación. La verificación más reciente, específica de PR 286, sí comparó todas las filas existentes antes/después de aplicar 0021/0022: 66 tablas/876 filas preservadas exactamente. La preservación local del release F8 se documenta por separado en [`TESTING.md`](TESTING.md). Las cinco tablas F7 estaban vacías en el snapshot de PR 235; no se cargó demo/seed de notas. Intermitencias E2E históricas de `public-interest`/guardado de grupos no se declaran universalmente resueltas por un run verde.

Fase 7 quedó liberada dentro de su alcance; al boundary de ese release, Fases 8 (cierre/planilla/reapertura) y 9 (certificados) no se habían iniciado. Fase 8 se integró posteriormente en development mediante PRs 280–285 y se liberó por PR 286, descrito abajo. Recovery/cambio de contraseña con entrega de correo, entrega cloud de SMTP, OAuth Google real y política de retención siguen pendientes según [`AUTHENTICATION.md`](AUTHENTICATION.md) y [`PLAN.md`](PLAN.md).

### Correcciones post-release Fase 7 — PR 278

PR 278 promovió las correcciones a `master` (`91beccf8`). CI run `37670004492` pasó al primer intento: 358 unit, 142 integration y full E2E 134/134, además de quality/build/migración/deploy PASS sin retries ni flakes reportados. Vercel deployment `dpl_CM7pwMYLxoqYBzP96KAeqQb8dxP7` está `READY` para el SHA exacto de master y alias `https://skillbase-alpha.vercel.app`. El smoke obtuvo 200 en rutas públicas/Auth y 303 en cuatro rutas privadas de evaluaciones sin sesión.

Al integrar PR 278, cloud seguía en ledger 21 y no hubo migración ni comparación completa de hashes; ese estado histórico fue supersedido por el release F8 PR 286, descrito abajo. Esto no afirma Google OAuth real o recovery/SMTP verificados. La historia de PR 275/276/277 y límites de causalidad de flakies se conservan en [`TESTING.md`](TESTING.md).

La primera revisión del workflow de shards (`4ecf1e`) pasó CI del PR `37675836980`: unit 371/2181 assertions, integration 142/1077 una vez y E2E 134/134 por dos runners independientes, sin skips/flakes/retries. La revisión actual añadió gating estricto por `quality`, integration y E2E, más cuatro tests/76 assertions; necesita nuevo run remoto antes de merge. En una observación, el envelope E2E fue 460 s baseline vs. 387 s candidato (-15.87 %), critical path requerido 730 vs. 426 s (-41.64 %) y consumo agregado no-deploy 789 s baseline vs. 931 s candidato (+18 %). Los jobs reportaron shards 416/297 s, integration 132 s, quality 78 s y aggregator 8 s; medición de un solo run, no garantía de reducción estable. El baseline production workflow no es directamente comparable: instalación Chromium 135 s vs. 62/19 s por runners ocurrió en hosts/redes diferentes, aunque la imagen Ubuntu coincidiera. No afirmar speedup robusto ni “2×”; medir más ejecuciones comparables antes de aceptarlo como optimización.

## Correcciones post-release Fase 7 — estado local pre-release (histórico)

En el snapshot anterior a la publicación, el source local `6b87d24d80df3810889139aa776604b0041b2802` (base `274db4cfdb7c927b3a69552eb8c0342fd363dbd2`) tenía validación local combinada completada. Los 132 casos E2E distintos estaban cubiertos por corridas separadas; no fue un full local único 132/132. Calidad/format/lint/typecheck/Drizzle/build estaban PASS, con integración 142/142 reutilizada desde una fuente con aplicación/schema sin cambios. Este estado de publicación bloqueada es histórico y queda supersedido por PR 278, documentado debajo.

En ese momento la publicación del commit quedó bloqueada: el push Git y las escrituras de blobs GitData REST reportaron HTTP 500; el publicador detuvo el intento. `origin/development` estaba reportado en `274db4c`; el commit `6b87d24` aún era local y no estaba mergeado. Este bloqueo se resolvió después con el release PR 278 registrado arriba; no se cambiaron branch protections.

En ese snapshot pre-release, production seguía en Fase 7 `master` `4afa485`, Vercel `READY`, Supabase cloud ledger 21. Después PR 278 liberó las correcciones; el estado actual está en la sección PR 286 abajo. Fase 8 aún no se había iniciado en ese momento histórico.

## Estado actual de shards y backend Fase 8

La nota intermedia de workflow pendiente arriba quedó supersedida cuando PR 279 se integró a `development`. El CI final `37684331005` pasó con 376 unit/2266 assertions, 142 integration/1077 assertions y 134/134 E2E (69+65), first-pass tras remediar provisioning APT. El shard fijo a Ubuntu 24.04 y sus timeouts/fuentes HTTPS quedaron verificados en ambos runners; no se cambia `master`/deploy por un chore separado.

## Release Fase 8 — PR 286 (`master` `68c918119f2ec094ba7cc63b217efd2448480505`)

PR 286 promovió el conjunto de PRs 280–285 a producción. El CI del SHA final
`68c918119f2ec094ba7cc63b217efd2448480505`, run `37727200394`, pasó todos los
jobs requeridos en attempt 1: 412 unit/2608 assertions, 160 integration/1314
assertions y 139 E2E únicos (131 Chromium desktop + 8 Chromium mobile). Los 139
casos pasaron first-pass; cero retries, flakes o skips. Typecheck 0 errores/0
warnings/306 hints; quality, migraciones y deploy PASS.

El owner, con autorización del usuario, omitió la aprobación administrativa
configurada solo después de comprobar que todos los checks requeridos estaban
verdes. No se cambiaron branch protections ni se omitieron checks.

Runs previos y de PRs individuales quedan como cronología y no se suman: PR 283
run `37717389828` (400/2530 unit, 160/1314 integration, 137 E2E), PR 284 run
`37718702107` (400 unit, 160 integration, 137 E2E), PR 285 run `37718988907`
(412/2608 unit, 160/1314 integration, 139 E2E). El run release-validation
anterior `37720672015` falló 1 E2E y retries por acumulación del bucket network
login en fixture Google-only; PR 287 corrigió únicamente el aislamiento de los
fixtures y el run final completo `37727200394` pasó como arriba. El límite runtime
Auth (10 intentos/15 min por bucket de red) no cambió.

El pipeline de PR 286 aplicó 0021 y 0022 en el orden versionado, avanzando tanto
Supabase canónico local como cloud de ledger 21 a 23. Entradas/checksums: 0021
timestamp `1791407807898`, SHA-256
`9b4c19be336426441b35d0ef1b0cd68ed7d980e4481420051d56fbb24d424259`; 0022
timestamp `1791414145526`, SHA-256
`c9792638377a89d162c64c951596b680c39c4f4017589f61a72844e85f55b856`. No hubo
SQL manual ni reset. La verificación cloud server-side comparó keys y hashes de
filas completas inmediatamente antes/después: 66 tablas/876 filas preservadas,
prefix del ledger 21 sin cambios y ambas nuevas entradas correctas. Las cinco
tablas F8 quedaron vacías; RLS, grants, funciones protegidas y triggers
esperados se verificaron. La base canónica local preservó 2,843 filas/64 tablas
en la comparación completa, incluyendo migración, replay y smoke.

El artifact de release confirmó Vercel deployment
`dpl_5z8QnQiF7H1naY4X33ZNe74sspzt` `READY` para el SHA exacto de master con alias
`https://skillbase-alpha.vercel.app`. Smoke postdeploy: 36 requests anónimos;
rutas públicas/Auth respondieron según esperado y privadas, incluidas cuentas
ADMIN y cierre, redirigieron a login. No se realizó smoke autenticado en
producción. No se crearon cuentas ADMIN reales, cierres, reaperturas, notas ni
seeds durante el release. La verificación focal de seis GET/download paths fue
en QA, no en producción. Google OAuth real, recovery y entrega SMTP/cloud no se
verifican por este release.

**Actualización del gate shards:** el status «requiere nuevo run» del registro previo quedó supersedido por PR 279/run `37684331005`, que pasó los dos shards y el agregador estricto tras la remediación APT. PR 279 se integró a `development`; no movió producción ni el ledger cloud.

Los adapters de export se integraron por PR 281 y UI/policy de cierre por PR 282; PR 284 añadió casos browser para descargas. La evidencia del release final y ledger 23 consta en la sección PR 286 arriba. No implica smoke autenticado ni uso de cuentas ADMIN reales en producción.

## Candidato de correcciones UI y demo integral (boundary histórico pre-release)

PR 289 integró las correcciones UI y PR 288 el runner manual sintético F1–F8 en
`development` (`53f171e10c6b5ac922d9f4c5760f788b9f7bdebe`). El CI integrado del
candidato pasó en PR 288, run `37818957648`, incluidos 424 unit/2,866 assertions,
162 integration/1,332 assertions, el test focal seed 1/1/890 en stack temporal
independiente y E2E 140/140; evidencia y cronología en [`TESTING.md`](TESTING.md).
Esto no es un release a `master`: al documentar este estado, `master` sigue en
`68c918119f2ec094ba7cc63b217efd2448480505` (release Fase 8), no se ha desplegado
el candidato y no se ha ejecutado seed en canónico local ni en cloud. El cambio
no añade migraciones ni modifica el schema. El nuevo CI/deploy de `master` deberá
pasar los gates existentes antes de promover correcciones o habilitar la operación
demo productiva. Este era el estado antes de PRs 292/293; la liberación y
ejecución protegida posterior se documenta a continuación.

El runner de demo integral no forma parte del job deploy ni de migraciones. Una
carga productiva, autorizada solo después del release completo, requiere checkout
limpio del SHA exacto de `master`, revisión del operador y `DEMO_APPROVED_RELEASE_SHA`,
PLAN seguido de APPLY manual, proyecto explícito y verificación/preservación
pre/post. No implica usar credenciales Auth existentes, enviar email, resetear la
base, ni crear datos de Fase 9. El procedimiento operativo completo y sus guards
están en [`DEMO_SEED.md`](DEMO_SEED.md).

## Release del canal protegido de demo integral (PR 292/293)

`master` se liberó en `2789d55e93a97cc5344930e690e9feecc2cc10f5`; `development`
está en `a276e30fab3526cc086fc3efbe03a42d08681ba9`. CI master
`37846141904` completó todos los gates en attempt 1 y Vercel deployment `dpl4CZ`
quedó READY para el mismo SHA. El workflow manual `production-comprehensive-demo.yml`
se ejecutó separadamente de deploy; PLAN `37854318652`, APPLY `37854790028`.
Preservación por filas, baseline/ledger, settings y dataset están en
[`DEMO_SEED.md`](DEMO_SEED.md). No se aplicó migración F9: los entornos canónicos
y cloud siguen en ledger 23; la migración candidata de certificados se prueba
aislada en ledger 24 y requiere el gate/release F9 normal.
