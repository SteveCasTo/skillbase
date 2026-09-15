# DEPLOYMENT

## OBJETIVO

Definir CI/CD y despliegue de producción.

## RAMAS

### development

Integración del desarrollo.

### master

Producción.

Cuando se habilite producción, un push válido a `master` deberá terminar en despliegue automático solamente si todos los gates pasan. Durante Foundation, `master` ejecuta únicamente validaciones.

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

Separar jobs cuando reduzca tiempo sin duplicar infraestructura pesada innecesariamente.

Ejemplo conceptual:

```text
static-checks
├── lint
├── format
└── typecheck

unit
└── unit tests

integration
└── Supabase local + integration tests

e2e
└── Supabase local + Playwright

build
└── production build
```

El workflow final puede optimizar dependencias entre jobs.

## DOCKER EN CI

Principios:

- imágenes oficiales;
- versiones fijadas;
- servicios mínimos;
- no usar contenedores innecesarios;
- no descargar browsers que no se ejecutarán;
- usar cache con cuidado;
- evitar imágenes custom grandes salvo necesidad real.

Supabase local debe levantarse únicamente en jobs que lo necesiten.

## MASTER PIPELINE OBJETIVO

```text
push master
→ install
→ static checks
→ tests
→ production build
→ [cuando producción esté enlazada] verify migrations
→ [cuando producción esté enlazada] apply pending migrations
→ [cuando producción esté enlazada] Vercel deploy
```

No desplegar si falla cualquier gate obligatorio.

## MIGRACIONES

Las migraciones viven versionadas en Git.

CI debe:

1. conectarse al proyecto Supabase de producción usando secrets;
2. verificar migraciones pendientes;
3. aplicar únicamente migraciones versionadas;
4. detener el deploy si falla la migración.

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

## PIPELINE IMPLEMENTADO

`.github/workflows/ci.yml` se ejecuta únicamente en:

- push a `master`;
- pull request cuyo destino sea `master`.

El job `quality` instala con lockfile y ejecuta checks estáticos, unit tests y build sin levantar Docker.

El job `integration-e2e` levanta una sola instancia mínima de Supabase, aplica migraciones, ejecuta integration tests y E2E con Chromium, y detiene Supabase incluso ante fallos.

El proyecto cloud Supabase `SkillBase` (`fvzxqlezdrlzykyoevub`) y el proyecto Vercel `stevecasto-projects/skillbase` están enlazados. El dominio de producción es `https://skillbase-alpha.vercel.app`; `skillbase.vercel.app` no está disponible porque pertenece a otra cuenta.

El job `deploy` se ejecuta únicamente en pushes a `master`, depende de `quality` e `integration-e2e`, aplica migraciones Drizzle y despliega el output preconstruido con Vercel CLI. La integración Git automática de Vercel está desconectada para impedir despliegues paralelos que omitan estos gates.

Las variables de Supabase local están limitadas a los jobs de calidad e integración. `deploy` descarga su entorno de producción desde Vercel para evitar que valores locales sobrescriban URLs, claves públicas o conexiones del build final.

El environment GitHub `production` restringe despliegues a ramas protegidas y contiene:

- `DATABASE_URL`: conexión de runtime mediante pooler compatible con serverless, configurada en Vercel;
- `MIGRATION_DATABASE_URL`: conexión de sesión con permiso para migraciones, almacenada como GitHub Environment secret;
- `VERCEL_TOKEN`: GitHub Environment secret;
- `VERCEL_ORG_ID`: GitHub Environment variable;
- `VERCEL_PROJECT_ID`: GitHub Environment variable.

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
