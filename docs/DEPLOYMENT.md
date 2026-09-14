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

Foundation no enlaza proyectos cloud ni ejecuta despliegues. Cuando existan Supabase Cloud y Vercel, el job de deploy deberá depender de ambos gates y utilizar estos GitHub Environment secrets de producción:

- `DATABASE_URL`: conexión directa de PostgreSQL con permiso para migraciones;
- `VERCEL_TOKEN`;
- `VERCEL_ORG_ID`;
- `VERCEL_PROJECT_ID`.

Vercel debe usar Node.js 22 o posterior. El proyecto usa el adapter oficial con salida server-side. Los previews administrados fuera de este workflow no deben recibir credenciales de producción.
