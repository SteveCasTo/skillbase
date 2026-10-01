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

`MIGRATION_DATABASE_URL` utiliza el pooler en session mode para conservar una sesión PostgreSQL durante las migraciones de Drizzle. No ejecutar migraciones mediante el pooler en transaction mode. Localmente ambas URLs pueden apuntar a `127.0.0.1:54322`.

Antes de habilitar Auth cloud se debe verificar explícitamente:

- signup público deshabilitado; email/password solo para cuentas internas preaprovisionadas y Google solo mediante identidad/invitación autorizada;
- Site URL y callback allowlist exactos;
- variables públicas y privadas asignadas al entorno correcto sin exponer secretos.

La configuración de producción existente corresponde al release de Fase 1/3; no acredita que el despliegue de autenticación dual esté configurado. La activación de Fase 4 requiere además el hook y redirects descritos más abajo. La clave legacy `service_role` debe rotarse o deshabilitarse antes de operar con datos reales porque una inspección inicial del CLI la mostró completa aun sin solicitar `--reveal`.

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

## PREPARACIÓN DE FASE 4 (pendiente)

- Las ramas de trabajo de Fase 4 se integran primero en `development`; no se despliega ni se promueve a `master` hasta la siguiente fase de release y sus gates/ventana autorizada.
- Cualquier reset de datos solicitado para preparar desarrollo es local y limitado a datos de aplicación sintéticos. No ejecutar reset de Auth ni de producción. Preservar identidad/cuenta ADMIN local válida y settings/secretos de proveedor; no automatizar reset de producción en deploy. Una futura renovación de demos cloud requiere gate manual y autorización explícita.
- Recuperación de contraseña depende de configuración SMTP de Supabase Auth: verificar remitente, proveedor y entrega en cloud antes de declarar recuperación por email lista. La verificación SMTP no bloquea el login email/password de una cuenta aprovisionada por ADMIN.
- Las claves de Google, service role y demás secretos permanecen server-only; no poner contraseña inicial de seed en Git. La provisión de cuentas de prueba debe obtener secretos por mecanismo local ignorado/proceso y no registrarlos.

## AUTH DUAL: IMPLEMENTADO EN FEATURE, DESPLIEGUE PENDIENTE

La rama `feat/dual-auth-and-profile` implementa login password interno, cambio/recovery, asociación Google con aprobación de aplicación y provisionamiento server-side de cuentas instructor. No tiene PR ni está integrada a `development`; no se ha desplegado ni habilitado en Supabase cloud. El release Fase 3 en `master` (`8f5bb2d`) permanece sin cambios.

Antes de activar la feature en un entorno:

1. Pasar migrations Drizzle `0012_dual_auth_security.sql` y `0013_google_link_requests.sql` mediante el flujo normal gated; no aplicar SQL a mano ni asumir que los archivos versionados equivalen a una migración aplicada.
2. Configurar en la instancia Auth efectiva el `before_user_created` hook hacia `private_auth.allow_invited_google_signup`, tras aplicar 0012. La función solo permite altas OAuth Google con invitación vigente y roles; las cuentas de password se crean por Admin API desde servidor. El `supabase/config.toml` de la rama define el hook local, pero no hay verificación/aplicación en el stack persistente ni cloud.
3. Proveer `AUTH_RATE_LIMIT_SECRET` como variable server-only con mínimo 32 caracteres, generada fuera de Git. Sin ella, limitación de intentos y pruebas firmadas fallan de forma segura; nunca imprimir ni entregar el valor al cliente.
4. Configurar redirect allowlist exacta para `/auth/callback` y `/auth/recovery` en cada entorno. Configurar/verificar el proveedor de email/SMTP y la entrega real antes de declarar recovery por correo operativo. Email recovery no bloquea login inicial con contraseña asignada por ADMIN.
5. Verificar rutas, guards, Auth hook, contadores y redacción mediante integración/CI y E2E; obtener la ventana de release posterior antes de cualquier promoción a `master`.

Supabase puede asociar automáticamente proveedores con emails verificados coincidentes; no documentar una garantía de que ese comportamiento proveedor pueda deshabilitarse. El requisito de aprobación explícita se aplica en la capa de acceso de SkillBase: se persiste `approved_google_identity_id` y una autenticación OAuth Google no aprobada se rechaza, aunque la identidad aparezca en Supabase Auth. Una sesión de password de la misma cuenta permanece independiente. No se ha cambiado Auth/SMTP cloud, reiniciado el stack local, aplicado migraciones ni ejecutado reset/seed como parte de esta documentación.
